import { spawn } from 'node:child_process';
import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type {
  ActualRuntimeState,
  CompiledRuntimeArtifacts,
  LaunchOptions,
  ManagedRuntimeFile,
  RuntimeAdapter,
  RuntimeApplyResult,
  RuntimeCompileInput,
  RuntimeContext,
  RuntimeDetection,
  RuntimeHealthResult,
  RuntimePlan,
} from '@nova-cbb/harness-core';
import { checksumOf, HarnessError } from '@nova-cbb/harness-shared';

const blockBegin = '<!-- NOVA-HARNESS:BEGIN role-profile -->';
const blockEnd = '<!-- NOVA-HARNESS:END role-profile -->';

/**
 * Claude Code Runtime 的完整适配器。
 * 它只写入带字段级或目录级 Ownership 的配置，Integrated 模式保留用户字段，
 * Isolated 模式则在 Harness 独立目录编译；所有 Apply 写入均带备份并可逆向恢复。
 */
export class ClaudeCodeRuntimeAdapter implements RuntimeAdapter {
  readonly id = 'claude-code';
  readonly displayName = 'Claude Code';

  async detect(): Promise<RuntimeDetection> {
    try {
      const output = await capture('claude', ['--version'], undefined, 10_000);
      return {
        installed: true,
        version: output.trim(),
        command: 'claude',
        capabilities: ['json-settings-merge', 'mcp-config', 'skills', 'permissions'],
      };
    } catch {
      return { installed: false, capabilities: [] };
    }
  }

  async inspect(context: RuntimeContext): Promise<ActualRuntimeState> {
    const paths = runtimePaths(context);
    const files = [];
    for (const path of [
      paths.settings,
      paths.mcp,
      paths.instructions,
      resolve(paths.marketplace, '.claude-plugin', 'marketplace.json'),
    ]) {
      const exists = await access(path).then(
        () => true,
        () => false,
      );
      files.push({
        path,
        exists,
        ...(exists
          ? {
              content: path.endsWith('.json') ? await readJson(path) : await readFile(path, 'utf8'),
            }
          : {}),
      });
    }
    for (const root of [paths.skills, paths.agents, paths.plugins]) {
      for (const name of await readdir(root).catch(() => [])) {
        const path = resolve(root, name);
        const marker = await managedDirectoryMarker(path);
        if (marker) files.push({ path, exists: true, content: marker });
      }
    }
    return { runtimeId: this.id, files };
  }

  compile(
    desired: RuntimeCompileInput,
    context: RuntimeContext,
  ): Promise<CompiledRuntimeArtifacts> {
    const paths = runtimePaths(context);
    const mcpServers: Record<string, unknown> = {};
    const warnings: string[] = [];
    for (const capability of desired.capabilities.filter(
      (item) => item.enabled && item.type === 'mcp',
    )) {
      if (!capability.command) {
        warnings.push(`${capability.id} has no compiled local command`);
        continue;
      }
      mcpServers[capability.id] = {
        command: capability.command.executable,
        args: capability.command.arguments,
        ...(Object.keys(capability.environment).length ? { env: capability.environment } : {}),
      };
    }
    const permissions = {
      allow: [] as string[],
      deny: [] as string[],
      requireApproval: [] as string[],
    };
    for (const rule of desired.permissions)
      permissions[rule.effect].push(formatPermission(rule.action, rule.resource));
    const enabledPlugins: Record<string, boolean> = {};
    const marketplacePlugins: Array<Record<string, unknown>> = [];
    const contentFiles: ManagedRuntimeFile[] = [];
    for (const capability of desired.capabilities.filter((item) => item.enabled)) {
      if (capability.type === 'plugin') {
        enabledPlugins[`${capability.id}@nova-hub`] = true;
        marketplacePlugins.push({
          name: capability.id,
          source: `./plugins/${capability.id}`,
          description: `由 Nova Harness 安装的 ${capability.id}`,
        });
        contentFiles.push({
          path: resolve(paths.plugins, capability.id),
          format: 'directory-link',
          content: { source: capability.storePath },
          managedKeys: [capability.id],
        });
      }
      if (capability.type === 'skill' || capability.type === 'agent') {
        contentFiles.push({
          path: resolve(capability.type === 'skill' ? paths.skills : paths.agents, capability.id),
          format: 'directory-link',
          content: { source: capability.storePath },
          managedKeys: [capability.id],
        });
      }
    }
    const files: ManagedRuntimeFile[] = [
      {
        path: paths.mcp,
        format: 'json',
        content: { mcpServers },
        managedKeys: Object.keys(mcpServers),
      },
      {
        path: paths.settings,
        format: 'json',
        content: {
          permissions,
          enabledPlugins,
          ...(marketplacePlugins.length
            ? {
                extraKnownMarketplaces: {
                  'nova-hub': { source: { source: 'directory', path: paths.marketplace } },
                },
              }
            : {}),
        },
        managedKeys: [
          'permissions.allow',
          'permissions.deny',
          'permissions.requireApproval',
          ...Object.keys(enabledPlugins).map((id) => `enabledPlugins.${id}`),
          ...(marketplacePlugins.length ? ['extraKnownMarketplaces.nova-hub'] : []),
        ],
      },
      {
        path: paths.instructions,
        format: 'markdown',
        content: `${blockBegin}\n当前角色：${desired.roleId}\n该区块由 Nova Harness 管理。\n${blockEnd}`,
        managedKeys: ['CLAUDE.md#nova-harness'],
      },
      {
        path: resolve(paths.marketplace, '.claude-plugin', 'marketplace.json'),
        format: 'json',
        content: {
          name: 'nova-hub',
          owner: { name: 'Nova Harness' },
          metadata: { description: 'Nova Harness 受管插件市场' },
          plugins: marketplacePlugins,
        },
        managedKeys: ['name', 'owner', 'metadata', 'plugins'],
      },
      ...contentFiles,
    ];
    return Promise.resolve({ runtimeId: this.id, files, warnings });
  }

  async plan(desired: CompiledRuntimeArtifacts, actual: ActualRuntimeState): Promise<RuntimePlan> {
    const current = new Map(actual.files.map((item) => [item.path, item.content]));
    const wanted = new Set(desired.files.map((file) => file.path));
    const writes: ManagedRuntimeFile[] = [];
    for (const file of desired.files) {
      if (file.format === 'directory-link') {
        const marker = current.get(file.path);
        if (
          !isRecord(marker) ||
          checksumOf(marker.source) !== checksumOf((file.content as { source?: unknown }).source)
        )
          writes.push(file);
        continue;
      }
      if (file.format === 'markdown') {
        const existing = current.get(file.path);
        const currentText = typeof existing === 'string' ? existing : '';
        if (mergeMarkdown(currentText, String(file.content)) !== existing) writes.push(file);
        continue;
      }
      const previousKeys = await readManagedKeys(file.path);
      const stale = previousKeys.some((key) => !file.managedKeys.includes(key));
      if (stale || !managedJsonMatches(current.get(file.path), file.content)) writes.push(file);
    }
    for (const file of actual.files) {
      if (!wanted.has(file.path) && isRecord(file.content) && file.content.novaManaged === true)
        writes.push({
          path: file.path,
          format: 'directory-link',
          content: file.content,
          managedKeys: [],
          operation: 'remove',
        });
    }
    return { runtimeId: this.id, writes, warnings: desired.warnings };
  }

  async apply(plan: RuntimePlan): Promise<RuntimeApplyResult> {
    const changedFiles: string[] = [];
    const backups: string[] = [];
    await preflight(plan.writes);
    try {
      for (const file of plan.writes) {
        await mkdir(dirname(file.path), { recursive: true });
        if (file.operation === 'remove') {
          const marker = await managedDirectoryMarker(file.path);
          if (!marker)
            throw new HarnessError({
              code: 'PERMISSION_DENIED',
              message: `拒绝删除未被 Nova Harness 管理的目录：${file.path}`,
            });
          const backup = `${file.path}.nova-backup-${Date.now()}`;
          await rename(file.path, backup);
          if (await exists(`${file.path}.nova-managed.json`))
            await rename(`${file.path}.nova-managed.json`, `${backup}.nova-managed.json`);
          changedFiles.push(file.path);
          backups.push(backup);
          continue;
        }
        if (file.format === 'directory-link') {
          const source =
            isRecord(file.content) && typeof file.content.source === 'string'
              ? file.content.source
              : undefined;
          if (!source)
            throw new HarnessError({
              code: 'CONFIG_INVALID',
              message: `目录制品缺少来源：${file.path}`,
            });
          const exists = await access(file.path).then(
            () => true,
            () => false,
          );
          const backup = `${file.path}.nova-backup-${Date.now()}`;
          if (exists) {
            if (!(await managedDirectoryMarker(file.path)))
              throw new HarnessError({
                code: 'PLAN_CONFLICT',
                message: `目标目录已存在且不属于 Nova Harness：${file.path}`,
              });
            await rename(file.path, backup);
            if (
              await access(`${file.path}.nova-managed.json`).then(
                () => true,
                () => false,
              )
            )
              await rename(`${file.path}.nova-managed.json`, `${backup}.nova-managed.json`);
            backups.push(backup);
          } else backups.push('');
          try {
            await symlink(source, file.path, process.platform === 'win32' ? 'junction' : 'dir');
          } catch {
            await cp(source, file.path, { recursive: true });
          }
          await writeFile(
            `${file.path}.nova-managed.json`,
            `${JSON.stringify({ novaManaged: true, source, managedAt: new Date().toISOString() }, null, 2)}\n`,
            'utf8',
          );
          changedFiles.push(file.path);
          continue;
        }
        const current = await readFile(file.path, 'utf8').catch(() => undefined);
        if (current !== undefined) {
          const backup = `${file.path}.nova-backup-${Date.now()}`;
          await writeFile(backup, current, { encoding: 'utf8', mode: 0o600 });
          if (await exists(`${file.path}.nova-managed.json`))
            await cp(`${file.path}.nova-managed.json`, `${backup}.nova-managed.json`);
          backups.push(backup);
        } else backups.push('');
        const next =
          file.format === 'json'
            ? await mergeJson(file.path, current, file.content, file.managedKeys)
            : mergeMarkdown(current ?? '', String(file.content));
        await atomicWrite(file.path, next);
        changedFiles.push(file.path);
      }
      return { changedFiles, backups };
    } catch (error) {
      for (let index = changedFiles.length - 1; index >= 0; index -= 1)
        await restoreChangedPath(changedFiles[index]!, backups[index]!).catch(() => undefined);
      throw error;
    }
  }

  async doctor(context: RuntimeContext): Promise<RuntimeHealthResult> {
    const detection = await this.detect();
    const paths = runtimePaths(context);
    const checks = [
      {
        id: 'binary',
        status: detection.installed ? ('healthy' as const) : ('unavailable' as const),
        message: detection.installed
          ? `Claude Code ${detection.version ?? ''}`.trim()
          : 'claude executable was not found',
      },
      {
        id: 'mode',
        status: 'healthy' as const,
        message: `${context.mode} configuration at ${dirname(paths.settings)}`,
      },
    ];
    return { status: detection.installed ? 'healthy' : 'unavailable', checks };
  }

  launch(options: LaunchOptions, context: RuntimeContext): Promise<number> {
    const env = { ...process.env, ...options.environment };
    if (context.mode === 'isolated')
      env.CLAUDE_CONFIG_DIR =
        context.isolatedRoot ??
        resolve(context.userHome, '.nova-harness', 'runtimes', 'claude-code', 'isolated');
    return inherit(
      'claude',
      options.arguments ?? [],
      options.projectDirectory ?? context.projectDirectory,
      env,
    );
  }
}

function runtimePaths(context: RuntimeContext): {
  settings: string;
  mcp: string;
  instructions: string;
  skills: string;
  agents: string;
  plugins: string;
  marketplace: string;
} {
  if (context.mode === 'isolated') {
    const root =
      context.isolatedRoot ??
      resolve(context.userHome, '.nova-harness', 'runtimes', 'claude-code', 'isolated');
    return {
      settings: resolve(root, 'settings.json'),
      mcp: resolve(root, 'mcp.json'),
      instructions: resolve(root, 'CLAUDE.md'),
      skills: resolve(root, 'skills'),
      agents: resolve(root, 'agents'),
      plugins: resolve(root, 'plugins'),
      marketplace: resolve(root, 'nova-marketplace'),
    };
  }
  if (context.identity.scope === 'project') {
    if (!context.projectDirectory)
      throw new HarnessError({
        code: 'CONFIG_INVALID',
        message: 'Project scope requires a project directory',
      });
    return {
      settings: resolve(context.projectDirectory, '.claude', 'settings.json'),
      mcp: resolve(context.projectDirectory, '.mcp.json'),
      instructions: resolve(context.projectDirectory, 'CLAUDE.md'),
      skills: resolve(context.projectDirectory, '.claude', 'skills'),
      agents: resolve(context.projectDirectory, '.claude', 'agents'),
      plugins: resolve(context.projectDirectory, '.claude', 'nova-plugins'),
      marketplace: resolve(context.projectDirectory, '.claude', 'nova-marketplace'),
    };
  }
  return {
    settings: resolve(context.userHome, '.claude', 'settings.json'),
    mcp: resolve(context.userHome, '.claude.json'),
    instructions: resolve(context.userHome, '.claude', 'CLAUDE.md'),
    skills: resolve(context.userHome, '.claude', 'skills'),
    agents: resolve(context.userHome, '.claude', 'agents'),
    plugins: resolve(context.userHome, '.claude', 'nova-plugins'),
    marketplace: resolve(context.userHome, '.claude', 'nova-marketplace'),
  };
}

/**
 * 读取目录 ownership 标记。只有存在该标记的目录才会参与幂等替换或清理，
 * 从而避免把用户手工创建的同名 Skill、Agent 或 Plugin 误认为 Harness 资产。
 */
async function managedDirectoryMarker(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const marker = JSON.parse(await readFile(`${path}.nova-managed.json`, 'utf8')) as unknown;
    return isRecord(marker) && marker.novaManaged === true ? marker : undefined;
  } catch {
    return undefined;
  }
}

/** 读取 JSON 文件对应的 ownership 键列表；损坏的标记按无标记处理。 */
async function readManagedKeys(path: string): Promise<string[]> {
  try {
    const value = JSON.parse(await readFile(`${path}.nova-managed.json`, 'utf8')) as {
      keys?: unknown;
    };
    return Array.isArray(value.keys)
      ? value.keys.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

/** 判断受管 JSON 片段是否已精确存在，忽略同文件中 Harness 不拥有的用户字段。 */
function managedJsonMatches(current: unknown, desired: unknown): boolean {
  if (!isRecord(current) || !isRecord(desired)) return false;
  return Object.entries(desired).every(([key, value]) =>
    isRecord(value)
      ? managedJsonMatches(current[key], value)
      : checksumOf(current[key]) === checksumOf(value),
  );
}

/**
 * 写入前完成所有可预见的冲突检查，避免修改一半后才发现同名用户目录。
 * JSON 也在此阶段解析，确保后续原子写失败之外不会出现内容级错误。
 */
async function preflight(files: ManagedRuntimeFile[]): Promise<void> {
  for (const file of files) {
    if (file.format === 'json') {
      const current = await readFile(file.path, 'utf8').catch(() => undefined);
      if (current !== undefined) JSON.parse(current);
    }
    if (file.format !== 'directory-link' || file.operation === 'remove') continue;
    const source =
      isRecord(file.content) && typeof file.content.source === 'string'
        ? file.content.source
        : undefined;
    if (!source || !(await exists(source)))
      throw new HarnessError({
        code: 'NOT_FOUND',
        message: `目录制品不存在：${source ?? file.path}`,
      });
    if ((await exists(file.path)) && !(await managedDirectoryMarker(file.path)))
      throw new HarnessError({
        code: 'PLAN_CONFLICT',
        message: `目标目录已存在且不属于 Nova Harness：${file.path}`,
      });
  }
}

/** 恢复单个 Runtime 路径；空备份表示 Apply 前不存在，因而直接删除新文件。 */
async function restoreChangedPath(path: string, backup: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
  await rm(`${path}.nova-managed.json`, { force: true });
  if (backup) await rename(backup, path);
  if (backup && (await exists(`${backup}.nova-managed.json`)))
    await rename(`${backup}.nova-managed.json`, `${path}.nova-managed.json`);
}

function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function mergeJson(
  path: string,
  current: string | undefined,
  managed: unknown,
  managedKeys: string[],
): Promise<string> {
  const base: unknown = current ? (JSON.parse(current) as unknown) : {};
  if (!isRecord(base) || !isRecord(managed))
    throw new HarnessError({
      code: 'CONFIG_INVALID',
      message: 'Claude settings must be JSON objects',
    });
  const markerPath = `${path}.nova-managed.json`;
  const previous = await readFile(markerPath, 'utf8').then(
    (value) => JSON.parse(value) as { keys?: string[] },
    () => ({ keys: [] as string[] }),
  );
  for (const key of previous.keys ?? []) removePath(base, key);
  const result = deepMerge(base, managed);
  await atomicWrite(markerPath, `${JSON.stringify({ keys: managedKeys }, null, 2)}\n`);
  return `${JSON.stringify(result, null, 2)}\n`;
}

/** 删除上一次 Harness 拥有的点路径，保留相邻的用户配置。 */
function removePath(root: Record<string, unknown>, path: string): void {
  const parts = path.split('.');
  let current = root;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!isRecord(next)) return;
    current = next;
  }
  const leaf = parts.at(-1);
  if (leaf) delete current[leaf];
}
function deepMerge(
  base: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const output = { ...base };
  for (const [key, value] of Object.entries(next))
    output[key] = isRecord(value) && isRecord(output[key]) ? deepMerge(output[key], value) : value;
  return output;
}
function mergeMarkdown(current: string, block: string): string {
  const start = current.indexOf(blockBegin);
  const end = current.indexOf(blockEnd);
  if (start >= 0 && end >= start)
    return (
      `${current.slice(0, start)}${block}${current.slice(end + blockEnd.length)}`.trimEnd() + '\n'
    );
  return `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${block}\n`;
}
async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
}
async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function formatPermission(action: string, resource: string): string {
  return resource === '*' ? action : `${action}(${resource})`;
}
function capture(command: string, args: string[], cwd?: string, timeout = 30_000): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      shell: process.platform === 'win32',
    });
    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.once('error', reject);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('timeout'));
    }, timeout);
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(`${command} exited ${String(code)}`));
    });
  });
}
function inherit(
  command: string,
  args: string[],
  cwd: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: 'inherit',
      windowsHide: false,
      shell: process.platform === 'win32',
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      resolvePromise(code ?? 1);
    });
  });
}
