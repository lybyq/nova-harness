import { homedir } from 'node:os';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  actualStateSchema,
  capabilitySchema,
  desiredStateSchema,
  executionPlanSchema,
  type Capability,
  type DesiredState,
  type ExecutionPlan,
  type StateIdentity,
} from '@nova-cbb/harness-contracts';
import { createExecutionPlan } from '@nova-cbb/harness-core';
import {
  ApplyEngine,
  ArtifactInstaller,
  FileStateStore,
  ProcessLock,
  type OperationExecutor,
  type OperationReceipt,
} from '@nova-cbb/harness-installer';
import { checksumOf, HarnessError } from '@nova-cbb/harness-shared';
import { ClaudeCodeRuntimeAdapter } from '@nova-cbb/runtime-claude-code';
import type { DeploymentProfile } from '@nova-cbb/harness-contracts';
import type { EnvironmentSecrets } from '../config/environment-secrets.js';
import type { HubClient } from '../hub/hub-client.js';
import { LocalCatalogStore } from '../config/local-catalog.js';
import { readSecretInput } from './secrets.js';

/**
 * 创建状态分区标识，确保不同部署、Runtime、用户/项目状态不会互相污染。
 * @param profile 当前部署配置。
 * @param scope 用户、项目或临时本地范围。
 * @param project 项目路径；项目范围会规范化为绝对路径。
 * @returns 可供 FileStateStore 使用的稳定标识。
 */
export function stateIdentity(
  profile: DeploymentProfile,
  scope: 'user' | 'project' | 'local',
  project?: string,
): StateIdentity {
  const globalScope = process.env.NOVA_SCOPE;
  if (globalScope === 'user' || globalScope === 'project' || globalScope === 'local')
    scope = globalScope;
  return {
    deploymentId: profile.metadata.id,
    runtimeId: profile.runtime.default,
    scope,
    ...(scope === 'project' || scope === 'local'
      ? { projectId: resolve(project ?? process.cwd()) }
      : {}),
  };
}

/**
 * 幂等初始化 Harness 目录、空状态和活动 Profile 元数据。
 * @returns 初始化位置、模式和是否已存在的摘要。
 * @throws 文件不可写或状态损坏时抛出领域错误/文件系统异常，不会覆盖已有 Desired。
 */
export async function initializeLocal(
  profile: DeploymentProfile,
  options: {
    scope: 'user' | 'project' | 'local';
    project?: string;
    mode?: 'integrated' | 'isolated';
  },
) {
  const store = new FileStateStore();
  await store.initialize();
  const identity = stateIdentity(profile, options.scope, options.project);
  const actual = await store.readActual(identity);
  await store.writeActual(actual);
  const existing = await store.readDesired(identity);
  const desired: DesiredState = {
    identity,
    roleId: 'unassigned',
    roleVersion: '0.0.0',
    capabilities: [],
    permissions: [],
    overrides: { add: [], remove: [], disable: [], configuration: {}, permissions: [] },
    checksum: checksumOf({ identity, roleId: 'unassigned', capabilities: [] }),
  };
  if (!existing) await store.writeDesired(desired);
  await mkdir(store.stateDirectory(identity), { recursive: true });
  await writeFile(
    resolve(store.stateDirectory(identity), 'active-profile.json'),
    `${JSON.stringify({ identity, mode: options.mode ?? profile.runtime.mode, initializedAt: new Date().toISOString() }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
  return {
    initialized: true,
    idempotent: Boolean(existing),
    root: store.layout.root,
    identity,
    mode: options.mode ?? profile.runtime.mode,
  };
}

/**
 * 读取本地 Desired/Actual 并计算轻量漂移，不执行任何网络或子进程检查。
 * @param identity 状态分区标识。
 * @returns 适合两秒内展示的状态摘要。
 */
export async function localStatus(identity: StateIdentity) {
  const store = new FileStateStore();
  const [desired, actual] = await Promise.all([
    store.readDesired(identity),
    store.readActual(identity),
  ]);
  return {
    identity,
    desiredRole: desired ? `${desired.roleId}@${desired.roleVersion}` : undefined,
    desiredCapabilities: desired?.capabilities.length ?? 0,
    installed: actual.installed,
    drift: desired
      ? desired.capabilities
          .filter(
            (item) =>
              !actual.installed.some(
                (installed) => installed.id === item.id && installed.version === item.version,
              ),
          )
          .map((item) => item.id)
      : [],
  };
}

/**
 * 根据持久化 Desired/Actual 生成并保存防漂移 Plan。
 * @throws 尚未初始化时抛出 CONFIG_INVALID。
 */
export async function createLocalPlan(identity: StateIdentity): Promise<ExecutionPlan> {
  const store = new FileStateStore();
  const desired = await store.readDesired(identity);
  if (!desired)
    throw new HarnessError({
      code: 'CONFIG_INVALID',
      message: 'Harness is not initialized for this scope',
      hint: 'Run nova init first.',
    });
  const actual = await store.readActual(identity);
  const plan = createExecutionPlan(desired, actual, {
    catalogChecksum: checksumOf(desired.capabilities),
  });
  await persistPlan(store, identity, plan);
  return plan;
}

/** 原子保存待确认 Plan；应用前仍会重新核对 Desired/Actual 校验和。 */
async function persistPlan(
  store: FileStateStore,
  identity: StateIdentity,
  plan: ExecutionPlan,
): Promise<void> {
  await writeFile(
    resolve(store.stateDirectory(identity), 'plan.json'),
    `${JSON.stringify(plan, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
}

/**
 * 通过 Hub 解析角色并更新 Desired，同时保留手工覆盖和本地可信能力。
 * @param identity 目标状态分区。
 * @param roleId 要切换的角色 ID。
 * @param hub 已配置鉴权、缓存和脱敏的 Hub 客户端。
 * @returns 基于新 Desired 生成的预览 Plan。
 */
export async function setRoleDesired(identity: StateIdentity, roleId: string, hub: HubClient) {
  const store = new FileStateStore();
  const current = await store.readDesired(identity);
  const overrides = current?.overrides ?? {
    add: [],
    remove: [],
    disable: [],
    configuration: {},
    permissions: [],
  };
  const localIds = new Set((await new LocalCatalogStore().list()).map((item) => item.id));
  const resolved = await hub.resolve<{
    role: { metadata: { version: string } };
    capabilities: DesiredState['capabilities'];
    permissions: DesiredState['permissions'];
    requiredSecrets: string[];
    warnings: string[];
    checksum: string;
  }>({
    runtime: identity.runtimeId,
    role: roleId,
    scope: identity.scope,
    add: overrides.add.filter((item) => !localIds.has(item.id)).map((item) => item.id),
    remove: overrides.remove,
    disable: overrides.disable,
    configuration: overrides.configuration,
    permissions: overrides.permissions,
  });
  const desired = desiredStateSchema.parse({
    identity,
    roleId,
    roleVersion: resolved.role.metadata.version,
    capabilities: [
      ...resolved.capabilities,
      ...(current?.capabilities.filter((item) => localIds.has(item.id)) ?? []),
    ],
    permissions: resolved.permissions,
    overrides,
    checksum: resolved.checksum,
  });
  await store.writeDesired(desired);
  const actual = await store.readActual(identity);
  const plan = createExecutionPlan(desired, actual, {
    catalogChecksum: checksumOf(resolved.capabilities),
    requiredSecrets: resolved.requiredSecrets,
    warnings: resolved.warnings,
  });
  await persistPlan(store, identity, plan);
  return plan;
}

/**
 * 在进程锁、Revision 和 Runtime 备份保护下应用最近一次 Plan。
 * Secret 仅在 Runtime 编译/启动边界按引用解析，不写入 Desired、Lock 或 Revision。
 * @throws Plan 漂移、完整性失败、未审批来源或运行时写入失败时抛出 HarnessError；
 *         ApplyEngine 会逆序撤销已完成操作并将 Revision 标记为 rolled-back。
 */
export async function applyLocalPlan(
  profile: DeploymentProfile,
  identity: StateIdentity,
  hub: HubClient,
  secrets: EnvironmentSecrets,
) {
  const store = new FileStateStore();
  const desired = await store.readDesired(identity);
  if (!desired)
    throw new HarnessError({ code: 'CONFIG_INVALID', message: 'Desired state is missing' });
  const plan = executionPlanSchema.parse(
    JSON.parse(
      await readFile(resolve(store.stateDirectory(identity), 'plan.json'), 'utf8'),
    ) as unknown,
  );
  let actual = await store.readActual(identity);
  if (plan.desiredChecksum !== desired.checksum || plan.actualChecksum !== checksumOf(actual))
    throw new HarnessError({ code: 'PLAN_STALE', message: 'Plan is stale; run nova plan again' });
  const capabilities = new Map<string, Capability>();
  for (const item of desired.capabilities) {
    const local = await new LocalCatalogStore().get(item.id);
    const capability = local ?? capabilitySchema.parse(await hub.capability(item.id));
    if (capability.source.kind === 'local' && process.env.NOVA_ALLOW_LOCAL !== 'yes')
      throw new HarnessError({
        code: 'UNTRUSTED_SOURCE',
        message: `${capability.id} 来自本地目录，需要本次会话显式批准`,
        hint: '重新执行 nova add <path> --type <type> --allow-untrusted --yes。',
      });
    if (capability.status === 'needs-review' && !profile.trust.allowUnreviewed)
      throw new HarnessError({
        code: 'UNTRUSTED_SOURCE',
        message: `${capability.id} 尚未通过 Hub 审核`,
        hint: '请让管理员审核，或在受控 Deployment Profile 中显式允许未审核能力。',
      });
    if (
      riskAtLeast(capability.riskLevel, profile.trust.requireApprovalAt) &&
      process.env.NOVA_APPROVE_HIGH_RISK !== 'yes'
    )
      throw new HarnessError({
        code: 'PERMISSION_DENIED',
        message: `${capability.id} 风险等级为 ${capability.riskLevel}，需要显式审批`,
        hint: '检查来源和维护人后使用全局 --yes 再次执行。',
      });
    capabilities.set(item.id, capability);
  }
  const requiredSecrets = [
    ...new Set(
      [...capabilities.values()].flatMap((capability) =>
        capability.secrets.filter((item) => item.required).map((item) => item.key),
      ),
    ),
  ];
  const missingSecrets: string[] = [];
  for (const reference of requiredSecrets)
    if (!(await secrets.has(reference))) missingSecrets.push(reference);
  for (const reference of missingSecrets) {
    if (process.env.NOVA_NON_INTERACTIVE === 'yes')
      throw new HarnessError({
        code: 'AUTH_REQUIRED',
        message: `非交互模式缺少必需 Secret：${missingSecrets.join(', ')}`,
        hint: `先执行 nova secret set ${reference}`,
        details: { missing: missingSecrets },
      });
    const input = await readSecretInput(reference);
    await secrets.set(reference, input.value);
  }
  const installer = new ArtifactInstaller(store.layout, profile, secrets);
  const runtime = new ClaudeCodeRuntimeAdapter();
  const executor: OperationExecutor = {
    async execute(operation): Promise<OperationReceipt> {
      const before = structuredClone(actual);
      let runtimeBackups: Array<{ path: string; backup: string }> = [];
      if (operation.type === 'install-capability' || operation.type === 'update-capability') {
        const capability = capabilities.get(operation.capabilityId!);
        const version = capability?.versions.find((item) => item.version === operation.toVersion);
        if (!capability || !version)
          throw new HarnessError({
            code: 'NOT_FOUND',
            message: `Capability version was not found: ${operation.target}`,
          });
        const receipt = await installer.install(capability, version);
        actual = {
          ...actual,
          installed: [
            ...actual.installed.filter((item) => item.id !== capability.id),
            {
              id: capability.id,
              version: version.version,
              enabled: true,
              sourceId: capability.source.sourceId,
              ...(receipt.integrity ? { integrity: receipt.integrity } : {}),
              installedAt: new Date().toISOString(),
              storePath: receipt.storePath,
            },
          ],
          observedAt: new Date().toISOString(),
        };
      } else if (operation.type === 'remove-capability')
        actual = {
          ...actual,
          installed: actual.installed.filter((item) => item.id !== operation.capabilityId),
          observedAt: new Date().toISOString(),
        };
      else if (operation.type === 'enable-capability' || operation.type === 'disable-capability')
        actual = {
          ...actual,
          installed: actual.installed.map((item) =>
            item.id === operation.capabilityId
              ? { ...item, enabled: operation.type === 'enable-capability' }
              : item,
          ),
          observedAt: new Date().toISOString(),
        };
      else if (operation.type === 'write-runtime-config') {
        const compiled = await runtime.compile(
          {
            roleId: desired.roleId,
            permissions: desired.permissions,
            capabilities: await Promise.all(
              actual.installed.map(async (item) => {
                const capability = capabilities.get(item.id);
                const configuredEnvironment = Object.fromEntries(
                  Object.entries(
                    desired.capabilities.find((entry) => entry.id === item.id)?.configuration ?? {},
                  ).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
                );
                const secretEnvironment: Record<string, string> = {};
                for (const definition of capability?.secrets ?? []) {
                  const configured = await secrets.has(definition.key);
                  if (configured) secretEnvironment[definition.key] = `\${${definition.key}}`;
                  else if (definition.required)
                    throw new HarnessError({
                      code: 'AUTH_REQUIRED',
                      message: `${item.id} 缺少 Secret：${definition.key}`,
                      hint: `执行 nova secret set ${definition.key}`,
                    });
                }
                return {
                  id: item.id,
                  type: capability?.type ?? 'unknown',
                  enabled: item.enabled,
                  storePath: item.storePath,
                  ...(capability?.type === 'mcp'
                    ? { command: await npmCommand(item.storePath) }
                    : {}),
                  environment: { ...configuredEnvironment, ...secretEnvironment },
                };
              }),
            ),
          },
          runtimeContext(profile, identity),
        );
        const inspected = await runtime.inspect(runtimeContext(profile, identity));
        const applied = await runtime.apply(await runtime.plan(compiled, inspected));
        runtimeBackups = applied.changedFiles.map((path, index) => ({
          path,
          backup: applied.backups[index] ?? '',
        }));
      }
      await store.writeActual(actual);
      return { operationId: operation.id, rollbackData: { actual: before, runtimeBackups } };
    },
    async rollback(_operation, receipt) {
      const data = receipt.rollbackData as {
        actual: unknown;
        runtimeBackups?: Array<{ path: string; backup: string }>;
      };
      actual = actualStateSchema.parse(data.actual);
      await store.writeActual(actual);
      for (const item of data.runtimeBackups ?? []) await restoreRuntimeBackup(item);
    },
  };
  const result = await new ApplyEngine(store, executor).apply(plan);
  const runtimeState = await runtime.inspect(runtimeContext(profile, identity));
  actual = {
    ...actual,
    appliedDesiredChecksum: desired.checksum,
    runtimeConfigurationChecksum: checksumOf(runtimeState.files),
    managedFiles: runtimeState.files
      .filter((file) => file.exists && file.content !== undefined)
      .map((file) => ({ path: file.path, checksum: checksumOf(file.content) })),
    observedAt: new Date().toISOString(),
  };
  await store.writeActual(actual);
  await store.writeOwnership(identity, {
    runtime: identity.runtimeId,
    managed: {
      userMcpServers:
        identity.scope === 'user'
          ? desired.capabilities
              .filter((item) => catalogType(capabilities, item.id) === 'mcp')
              .map((item) => item.id)
          : [],
      projectMcpServers:
        identity.scope !== 'user'
          ? desired.capabilities
              .filter((item) => catalogType(capabilities, item.id) === 'mcp')
              .map((item) => item.id)
          : [],
      plugins: desired.capabilities
        .filter((item) => catalogType(capabilities, item.id) === 'plugin')
        .map((item) => item.id),
      skills: desired.capabilities
        .filter((item) => catalogType(capabilities, item.id) === 'skill')
        .map((item) => item.id),
      agents: desired.capabilities
        .filter((item) => catalogType(capabilities, item.id) === 'agent')
        .map((item) => item.id),
      settingsPaths: runtimeState.files.filter((file) => file.exists).map((file) => file.path),
      managedBlocks: ['CLAUDE.md#nova-harness'],
    },
  });
  const lockPath = await store.writeHarnessLock(
    identity,
    createHarnessLock(desired, actual, capabilities),
  );
  await store.snapshotRevisionState(
    resolve(store.layout.revisions, result.revisionId),
    'after',
    identity,
  );
  return { ...result, lockPath };
}

/** 对当前 Claude Code 编译产物执行只读 Runtime 专项诊断。 */
export async function runtimeDoctor(profile: DeploymentProfile, identity: StateIdentity) {
  return new ClaudeCodeRuntimeAdapter().doctor(runtimeContext(profile, identity));
}
/**
 * 启动 Runtime，并且只把配置实际引用的 Secret 注入子进程环境。
 * @param arguments_ 原样数组传入可执行文件，始终禁用 Shell 以避免注入。
 * @returns 子进程退出码；信号退出统一返回 1。
 */
export async function launchRuntime(
  profile: DeploymentProfile,
  identity: StateIdentity,
  args: string[],
  secrets?: EnvironmentSecrets,
) {
  const environment: Record<string, string> = {};
  const adapter = new ClaudeCodeRuntimeAdapter();
  const context = runtimeContext(profile, identity);
  const inspected = await adapter.inspect(context);
  const references = new Set<string>();
  const serialized = JSON.stringify(inspected.files);
  for (const match of serialized.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g))
    if (match[1]) references.add(match[1]);
  for (const key of references) {
    const value = await secrets?.get(key);
    if (value) environment[key] = value;
  }
  return adapter.launch(
    {
      arguments: args,
      environment,
      ...(identity.projectId ? { projectDirectory: identity.projectId } : {}),
    },
    context,
  );
}
/** 按时间倒序读取 Revision 摘要，不返回快照中的潜在敏感原文。 */
export async function revisionHistory() {
  const store = new FileStateStore();
  await store.initialize();
  return (await readdir(store.layout.revisions, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
}

/** 返回指定 Revision 的完整审计摘要。 */
export async function revisionDetails(id: string) {
  return new FileStateStore().readRevision(id);
}

/**
 * 在全局锁下恢复 Harness 状态和 Apply 记录的 Runtime 文件备份。
 * 未指定 ID 时使用最近一次 Revision；不可变 Store 不删除，因此旧版本仍可离线启动。
 */
export async function rollbackRevision(id?: string) {
  const store = new FileStateStore();
  await store.initialize();
  const lock = new ProcessLock(store.layout.lock);
  await lock.acquire();
  try {
    const revisionId = id ?? (await revisionHistory())[0];
    if (!revisionId)
      throw new HarnessError({ code: 'NOT_FOUND', message: '没有可回滚的 Revision' });
    const details = await store.readRevision(revisionId);
    const rollback = details.rollback as
      | {
          operations?: Array<{
            receipt?: {
              rollbackData?: { runtimeBackups?: Array<{ path: string; backup: string }> };
            };
          }>;
        }
      | undefined;
    for (const entry of rollback?.operations ?? [])
      for (const item of entry.receipt?.rollbackData?.runtimeBackups ?? [])
        await restoreRuntimeBackup(item);
    const identity = await store.restoreRevisionState(revisionId);
    if (identity.projectId) {
      const stateLock = resolve(store.stateDirectory(identity), 'harness.lock');
      const projectLock = resolve(identity.projectId, '.nova', 'harness.lock');
      if (await pathExists(stateLock)) {
        await mkdir(resolve(projectLock, '..'), { recursive: true });
        await writeFile(projectLock, await readFile(stateLock));
      } else await rm(projectLock, { force: true });
    }
    return { rolledBack: true, revisionId, identity };
  } finally {
    await lock.release();
  }
}
function runtimeContext(profile: DeploymentProfile, identity: StateIdentity) {
  return {
    identity,
    mode: profile.runtime.mode,
    userHome: homedir(),
    ...(identity.projectId ? { projectDirectory: identity.projectId } : {}),
    isolatedRoot: resolve(new FileStateStore().layout.runtime, 'claude-code', 'isolated'),
  };
}
async function npmCommand(storePath: string): Promise<{ executable: string; arguments: string[] }> {
  const pkg = JSON.parse(await readFile(resolve(storePath, 'package.json'), 'utf8')) as {
    bin?: string | Record<string, string>;
  };
  const entry =
    typeof pkg.bin === 'string' ? pkg.bin : pkg.bin ? Object.values(pkg.bin)[0] : undefined;
  if (!entry)
    throw new HarnessError({
      code: 'INTEGRITY_FAILED',
      message: `No executable entry in ${storePath}`,
    });
  return { executable: process.execPath, arguments: [resolve(storePath, entry)] };
}

/**
 * 恢复 Runtime Apply 记录的文件或目录。空 backup 表示原路径不存在；
 * 非空 backup 使用 rename 同盘恢复，兼容普通文件、目录与 Windows Junction。
 */
async function restoreRuntimeBackup(item: { path: string; backup: string }): Promise<void> {
  await rm(item.path, { recursive: true, force: true });
  await rm(`${item.path}.nova-managed.json`, { force: true });
  if (item.backup) await rename(item.backup, item.path);
  if (item.backup && (await pathExists(`${item.backup}.nova-managed.json`)))
    await rename(`${item.backup}.nova-managed.json`, `${item.path}.nova-managed.json`);
}

function pathExists(path: string): Promise<boolean> {
  return readFile(path).then(
    () => true,
    () => false,
  );
}

/** 比较风险等级是否达到 Deployment 要求的人工审批阈值。 */
function riskAtLeast(
  actual: 'low' | 'medium' | 'high' | 'critical',
  threshold: 'low' | 'medium' | 'high' | 'critical',
): boolean {
  const rank = { low: 0, medium: 1, high: 2, critical: 3 } as const;
  return rank[actual] >= rank[threshold];
}

/**
 * 由 Desired、Actual 与 Catalog 事实生成可复现锁文件。
 * 只写 Source ID/locator 等非敏感标识；Token、authRef、配置值和环境变量均不进入 Lock。
 */
function createHarnessLock(
  desired: DesiredState,
  actual: Awaited<ReturnType<FileStateStore['readActual']>>,
  catalog: Map<string, Capability>,
) {
  return {
    apiVersion: 'harness.nova/v1',
    kind: 'HarnessLock',
    generatedAt: new Date().toISOString(),
    identity: desired.identity,
    role: { id: desired.roleId, version: desired.roleVersion },
    capabilities: desired.capabilities.map((item) => {
      const capability = catalog.get(item.id);
      const version = capability?.versions.find((candidate) => candidate.version === item.version);
      const installed = actual.installed.find((candidate) => candidate.id === item.id);
      return {
        id: item.id,
        version: item.version,
        enabled: item.enabled,
        source: capability
          ? { sourceId: capability.source.sourceId, locator: capability.source.locator }
          : undefined,
        integrity: version?.integrity,
        archiveSha256: version?.archiveSha256,
        commitSha: version?.commitSha,
        manifestChecksum: version?.manifestChecksum,
        runtimeBinding: version?.runtimeBindings[desired.identity.runtimeId],
        dependencies: version?.dependencies ?? [],
        installedAt: installed?.installedAt,
      };
    }),
    checksum: checksumOf({ desired: desired.checksum, installed: actual.installed }),
  };
}

function catalogType(catalog: Map<string, Capability>, id: string): string | undefined {
  return catalog.get(id)?.type;
}
