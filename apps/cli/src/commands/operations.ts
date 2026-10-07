import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import {
  desiredStateSchema,
  type DeploymentProfile,
  type StateIdentity,
} from '@nova-cbb/harness-contracts';
import { FileStateStore } from '@nova-cbb/harness-installer';
import { checksumOf, HarnessError } from '@nova-cbb/harness-shared';
import { ClaudeCodeRuntimeAdapter } from '@nova-cbb/runtime-claude-code';
import { parse, stringify } from 'yaml';
import { createLocalPlan, revisionDetails, revisionHistory } from './local-state.js';

/** 返回适合表格输出的能力状态列表。 */
export async function listCapabilities(identity: StateIdentity) {
  const store = new FileStateStore();
  const [desired, actual] = await Promise.all([
    store.readDesired(identity),
    store.readActual(identity),
  ]);
  return (desired?.capabilities ?? []).map((item) => {
    const installed = actual.installed.find((entry) => entry.id === item.id);
    return {
      capability: item.id,
      desiredVersion: item.version,
      installedVersion: installed?.version,
      installed: Boolean(installed),
      configured: Object.keys(item.configuration).length > 0,
      enabled: item.enabled,
      reason: item.reason,
    };
  });
}

/** 汇总 Desired、Actual、Ownership 和最近 Plan，用于只读排障。 */
export async function inspectState(identity: StateIdentity) {
  const store = new FileStateStore();
  const directory = store.stateDirectory(identity);
  const read = async (name: string) =>
    JSON.parse(await readFile(resolve(directory, name), 'utf8')) as unknown;
  return {
    desired: await store.readDesired(identity),
    actual: await store.readActual(identity),
    ownership: await read('ownership.json').catch(() => undefined),
    plan: await read('plan.json').catch(() => undefined),
  };
}

/** 生成最新 Plan 并返回人类可读的操作差异。 */
export async function diffState(identity: StateIdentity) {
  const plan = await createLocalPlan(identity);
  return {
    planId: plan.id,
    changes: plan.operations.map((operation) => ({
      type: operation.type,
      target: operation.target,
      from: operation.fromVersion,
      to: operation.toVersion,
      destructive: operation.destructive,
    })),
  };
}

/** 导出不含 Secret 的 Desired State，可选附带项目 Lock。 */
export async function exportState(identity: StateIdentity, path: string, includeLock: boolean) {
  const store = new FileStateStore();
  const desired = await store.readDesired(identity);
  if (!desired) throw new HarnessError({ code: 'CONFIG_INVALID', message: '当前作用域尚未初始化' });
  const document = {
    apiVersion: 'harness.nova/v1',
    kind: 'HarnessExport',
    exportedAt: new Date().toISOString(),
    desired,
    ...(includeLock
      ? {
          lock: {
            checksum: desired.checksum,
            capabilities: Object.fromEntries(
              desired.capabilities.map((item) => [item.id, item.version]),
            ),
          },
        }
      : {}),
  };
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(path, stringify(document), 'utf8');
  return { path: resolve(path), checksum: checksumOf(document), secretIncluded: false };
}

/** 导入 HarnessExport 的 Desired State；严格校验 identity 后才覆盖。 */
export async function importState(identity: StateIdentity, path: string) {
  const raw = parse(await readFile(path, 'utf8')) as unknown;
  if (!isRecord(raw) || raw.kind !== 'HarnessExport')
    throw new HarnessError({ code: 'CONFIG_INVALID', message: '导入文件不是 HarnessExport' });
  const desired = desiredStateSchema.parse(raw.desired);
  if (checksumOf(desired.identity) !== checksumOf(identity))
    throw new HarnessError({ code: 'PLAN_CONFLICT', message: '导入文件作用域与当前作用域不一致' });
  await new FileStateStore().writeDesired(desired);
  return createLocalPlan(identity);
}

/** 返回缓存、Store 和 Revision 的文件数及大小。 */
export async function cacheStatus() {
  const layout = new FileStateStore().layout;
  return {
    cache: await treeStats(layout.cache),
    store: await treeStats(layout.store),
    revisions: await treeStats(layout.revisions),
  };
}

/** 校验 Actual State 中每个不可变 Store 路径和 npm 入口是否仍存在。 */
export async function verifyCache() {
  const store = new FileStateStore();
  await store.initialize();
  const failures: Array<{ path: string; reason: string }> = [];
  for (const stateDir of await subdirectories(store.layout.state)) {
    const path = resolve(stateDir, 'actual.json');
    try {
      const value = JSON.parse(await readFile(path, 'utf8')) as {
        installed?: Array<{ storePath: string }>;
      };
      for (const item of value.installed ?? []) {
        if (!(await exists(item.storePath))) {
          failures.push({ path: item.storePath, reason: 'missing' });
          continue;
        }
        try {
          const marker = JSON.parse(
            await readFile(resolve(item.storePath, '.nova-store.json'), 'utf8'),
          ) as { checksum?: string };
          const checksum = await directoryChecksum(item.storePath);
          if (!marker.checksum || marker.checksum !== checksum)
            failures.push({ path: item.storePath, reason: 'checksum-mismatch' });
        } catch {
          failures.push({ path: item.storePath, reason: 'integrity-marker-missing' });
        }
      }
    } catch {
      /* 非 identity 目录或损坏状态由 doctor 报告 */
    }
  }
  return { status: failures.length ? 'corrupted' : 'healthy', failures };
}

/** 清理可再生的 HTTP/Manifest 缓存和临时目录，不删除版本化 Store。 */
export async function cleanCache() {
  const layout = new FileStateStore().layout;
  for (const target of [layout.cache, layout.temp]) {
    assertInside(layout.root, target);
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });
  }
  return { cleaned: [layout.cache, layout.temp] };
}

/** 删除所有 Actual State 均未引用的 Store 版本目录。 */
export async function pruneStore() {
  const store = new FileStateStore();
  await store.initialize();
  const referenced = new Set<string>();
  for (const stateDir of await subdirectories(store.layout.state)) {
    try {
      const value = JSON.parse(await readFile(resolve(stateDir, 'actual.json'), 'utf8')) as {
        installed?: Array<{ storePath: string }>;
      };
      for (const item of value.installed ?? []) referenced.add(resolve(item.storePath));
    } catch {
      /* doctor 单独处理 */
    }
  }
  for (const revision of await subdirectories(store.layout.revisions))
    for (const phase of ['before', 'after']) {
      try {
        const value = JSON.parse(
          await readFile(resolve(revision, phase, 'actual.json'), 'utf8'),
        ) as { installed?: Array<{ storePath: string }> };
        for (const item of value.installed ?? []) referenced.add(resolve(item.storePath));
      } catch {
        /* 缺少阶段快照的失败 Revision 不增加引用；其 Journal 仍由 history 保留。 */
      }
    }
  const removed: string[] = [];
  for (const kind of await subdirectories(store.layout.store))
    for (const capability of await subdirectories(kind))
      for (const version of await subdirectories(capability))
        if (!referenced.has(resolve(version))) {
          assertInside(store.layout.store, version);
          await rm(version, { recursive: true, force: true });
          removed.push(version);
        }
  return { removed };
}

/** 把 Revision 结果转换为本地审计记录。 */
export async function auditRecords() {
  const records = [];
  for (const id of await revisionHistory()) {
    const detail = await revisionDetails(id);
    records.push({ id, metadata: detail.metadata, result: detail.result });
  }
  return records;
}

/** 导出审计 JSON，不包含日志中的已脱敏 Secret。 */
export async function exportAudit(path: string) {
  const records = await auditRecords();
  await writeFile(path, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  return { path: resolve(path), records: records.length };
}

/** 读取本地日志文件列表；`tail` 限制每个文件返回的最后行数。 */
export async function readLogs(tail = 100, capabilityId?: string) {
  const layout = new FileStateStore().layout;
  await mkdir(layout.logs, { recursive: true });
  const output = [];
  for (const entry of await readdir(layout.logs, { withFileTypes: true }))
    if (entry.isFile() && entry.name.endsWith('.log')) {
      const content = await readFile(resolve(layout.logs, entry.name), 'utf8');
      const lines = content
        .split(/\r?\n/)
        .filter((line) => line && (!capabilityId || line.includes(capabilityId)));
      if (!capabilityId || lines.length)
        output.push({ file: entry.name, lines: lines.slice(-tail) });
    }
  return output;
}

/** 返回 Claude Code Runtime 的检测、配置和当前状态。 */
export async function runtimeOverview(
  profile: DeploymentProfile,
  identity: StateIdentity,
  mode: 'detect' | 'status' | 'inspect',
) {
  const adapter = new ClaudeCodeRuntimeAdapter();
  if (mode === 'detect') return adapter.detect();
  if (mode === 'inspect') return adapter.inspect(runtimeContext(profile, identity));
  return adapter.doctor(runtimeContext(profile, identity));
}

/** 导出 Runtime 只读检查结果，便于跨机器排障。 */
export async function exportRuntime(
  profile: DeploymentProfile,
  identity: StateIdentity,
  path: string,
) {
  const inspected = await runtimeOverview(profile, identity, 'inspect');
  await writeFile(path, `${JSON.stringify(inspected, null, 2)}\n`, 'utf8');
  return { path: resolve(path) };
}

/** 生成不依赖 shell 动态查询的静态补全脚本。 */
export function completion(shell: 'bash' | 'zsh' | 'powershell'): string {
  const commands =
    'init hub search info versions dependencies compatibility add remove enable disable role project list status inspect plan apply diff doctor update history rollback secret runtime launch exec logs audit export import cache prune completion';
  if (shell === 'powershell')
    return `Register-ArgumentCompleter -Native -CommandName nova -ScriptBlock { param($wordToComplete) '${commands}'.Split(' ') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_,$_, 'ParameterValue', $_) } }`;
  if (shell === 'zsh')
    return `#compdef nova\n_nova() { local -a commands; commands=(${commands}); _describe 'nova command' commands }\ncompdef _nova nova`;
  return `_nova_completions() { local cmds="${commands}"; COMPREPLY=( $(compgen -W "$cmds" -- "${'$'}{COMP_WORDS[1]}") ); }\ncomplete -F _nova_completions nova`;
}

function runtimeContext(profile: DeploymentProfile, identity: StateIdentity) {
  const layout = new FileStateStore().layout;
  return {
    identity,
    mode: profile.runtime.mode,
    userHome: process.env.USERPROFILE ?? process.env.HOME ?? '',
    ...(identity.projectId ? { projectDirectory: identity.projectId } : {}),
    isolatedRoot: resolve(layout.runtime, 'claude-code', 'isolated'),
  };
}
async function subdirectories(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => resolve(path, entry.name));
  } catch {
    return [];
  }
}
async function treeStats(root: string) {
  let files = 0;
  let bytes = 0;
  const visit = async (path: string): Promise<void> => {
    for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) {
        files += 1;
        bytes += (await stat(child)).size;
      }
    }
  };
  await visit(root);
  return { path: root, files, bytes };
}
function assertInside(root: string, target: string): void {
  const value = relative(resolve(root), resolve(target));
  if (!value || value.startsWith(`..${sep}`) || value === '..')
    throw new HarnessError({
      code: 'PERMISSION_DENIED',
      message: `拒绝操作 Harness 根目录之外的路径：${target}`,
    });
}
function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 与安装器一致地重算 Store 内容摘要，用于发现离线缓存被篡改或磁盘损坏。 */
async function directoryChecksum(root: string): Promise<string> {
  const hash = createHash('sha256');
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === '.nova-store.json') continue;
      const path = resolve(directory, entry.name);
      const relativePath = relative(root, path).replaceAll('\\', '/');
      if (entry.isDirectory()) {
        hash.update(`d:${relativePath}\n`);
        await visit(path);
      } else if (entry.isFile()) {
        const details = await stat(path);
        hash.update(`f:${relativePath}:${details.size}\n`);
        hash.update(await readFile(path));
      }
    }
  };
  await visit(root);
  return hash.digest('hex');
}
