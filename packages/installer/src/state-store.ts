import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type {
  ActualState,
  DesiredState,
  ExecutionPlan,
  StateIdentity,
} from '@nova-cbb/harness-contracts';
import {
  actualStateSchema,
  desiredStateSchema,
  executionPlanSchema,
  stateIdentitySchema,
} from '@nova-cbb/harness-contracts';
import { checksumOf, HarnessError } from '@nova-cbb/harness-shared';
import { harnessLayout, identityKey, type HarnessLayout } from './layout.js';

/** Harness 在目标 Runtime 中拥有的字段、能力目录和 Markdown 管理块。 */
export interface Ownership {
  runtime: string;
  managed: {
    userMcpServers: string[];
    projectMcpServers: string[];
    plugins: string[];
    skills: string[];
    agents: string[];
    settingsPaths: string[];
    managedBlocks: string[];
  };
}

/**
 * Desired/Actual/Plan/Ownership/Revision 的原子文件仓库。
 * 所有路径由规范化 identity 推导，写入使用同目录临时文件 + rename，文件权限限制为当前用户。
 */
export class FileStateStore {
  readonly layout: HarnessLayout;
  constructor(root?: string) {
    this.layout = harnessLayout(root);
  }

  async initialize(): Promise<void> {
    const directories = [
      this.layout.config,
      this.layout.state,
      this.layout.revisions,
      this.layout.store,
      this.layout.runtime,
      this.layout.cache,
      this.layout.logs,
      this.layout.temp,
    ];
    await Promise.all(directories.map((path) => mkdir(path, { recursive: true })));
  }

  stateDirectory(identity: StateIdentity): string {
    return resolve(this.layout.state, identityKey(identity));
  }

  async readDesired(identity: StateIdentity): Promise<DesiredState | undefined> {
    return this.#readJson(resolve(this.stateDirectory(identity), 'desired.json'), (value) =>
      desiredStateSchema.parse(value),
    );
  }

  async readActual(identity: StateIdentity): Promise<ActualState> {
    const found = await this.#readJson(
      resolve(this.stateDirectory(identity), 'actual.json'),
      (value) => actualStateSchema.parse(value),
    );
    return (
      found ?? { identity, installed: [], managedFiles: [], observedAt: new Date().toISOString() }
    );
  }

  async writeDesired(value: DesiredState): Promise<void> {
    await this.#writeJson(resolve(this.stateDirectory(value.identity), 'desired.json'), value);
  }
  async writeActual(value: ActualState): Promise<void> {
    await this.#writeJson(resolve(this.stateDirectory(value.identity), 'actual.json'), value);
  }
  async writeOwnership(identity: StateIdentity, value: Ownership): Promise<void> {
    await this.#writeJson(resolve(this.stateDirectory(identity), 'ownership.json'), value);
  }

  async createRevision(plan: ExecutionPlan): Promise<{ id: string; directory: string }> {
    const stamp = plan.createdAt.replace(/[-:TZ.]/g, '').slice(0, 14);
    const id = `rev-${stamp}-${checksumOf(plan).slice(0, 6)}`;
    const directory = resolve(this.layout.revisions, id);
    await mkdir(resolve(directory, 'before'), { recursive: true });
    await mkdir(resolve(directory, 'after'), { recursive: true });
    await this.#writeJson(resolve(directory, 'metadata.json'), {
      id,
      status: 'prepared',
      createdAt: new Date().toISOString(),
      identity: plan.identity,
    });
    await this.#writeJson(resolve(directory, 'plan.json'), executionPlanSchema.parse(plan));
    await this.snapshotRevisionState(directory, 'before', plan.identity);
    return { id, directory };
  }

  /** 保存 Apply 前后四个 Harness 受管状态文件；缺失文件按缺失状态记录。 */
  async snapshotRevisionState(
    directory: string,
    phase: 'before' | 'after',
    identity: StateIdentity,
  ): Promise<void> {
    const source = this.stateDirectory(identity);
    const target = resolve(directory, phase);
    await mkdir(target, { recursive: true });
    for (const name of [
      'desired.json',
      'actual.json',
      'ownership.json',
      'active-profile.json',
      'harness.lock',
    ])
      await copyFile(resolve(source, name), resolve(target, name)).catch((error: unknown) => {
        if (!isNotFound(error)) throw error;
      });
  }

  /** 读取 Revision 的计划、结果和回滚清单，不返回 Secret 值。 */
  async readRevision(id: string): Promise<Record<string, unknown>> {
    const directory = this.#revisionDirectory(id);
    const output: Record<string, unknown> = { id };
    for (const name of ['metadata.json', 'plan.json', 'result.json', 'rollback.json']) {
      const value = await this.#readJson(resolve(directory, name), (item) => item);
      if (value !== undefined) output[name.replace('.json', '')] = value;
    }
    return output;
  }

  /** 在调用方持有全局锁时恢复 Revision 的 Harness 状态快照。 */
  async restoreRevisionState(id: string): Promise<StateIdentity> {
    const directory = this.#revisionDirectory(id);
    const metadata = (await this.#readJson(resolve(directory, 'metadata.json'), (item) => item)) as
      { identity?: unknown } | undefined;
    const identity = stateIdentitySchema.parse(metadata?.identity);
    const target = this.stateDirectory(identity);
    await mkdir(target, { recursive: true });
    for (const name of [
      'desired.json',
      'actual.json',
      'ownership.json',
      'active-profile.json',
      'harness.lock',
    ]) {
      const source = resolve(directory, 'before', name);
      const destination = resolve(target, name);
      if (await exists(source)) await copyFile(source, destination);
      else await rm(destination, { force: true });
    }
    return identity;
  }

  async writeRevisionFile(directory: string, name: string, value: unknown): Promise<void> {
    const target = resolve(directory, name);
    if (!target.startsWith(resolve(this.layout.revisions)))
      throw new HarnessError({
        code: 'PERMISSION_DENIED',
        message: 'Revision path escapes the Harness state root',
      });
    await this.#writeJson(target, value);
  }

  /**
   * 原子写入不含凭据的解析锁文件，并在 project/local 作用域同步到项目 `.nova/harness.lock`。
   * 调用方负责提供已经过契约校验和脱敏的内容。
   */
  async writeHarnessLock(identity: StateIdentity, value: unknown): Promise<string> {
    const statePath = resolve(this.stateDirectory(identity), 'harness.lock');
    await this.#writeJson(statePath, value);
    if (identity.projectId) {
      const projectPath = resolve(identity.projectId, '.nova', 'harness.lock');
      await this.#writeJson(projectPath, value);
      return projectPath;
    }
    return statePath;
  }

  #revisionDirectory(id: string): string {
    if (!/^rev-\d{14}-[a-f0-9]{6}$/i.test(id))
      throw new HarnessError({ code: 'CONFIG_INVALID', message: `Revision ID 无效：${id}` });
    return resolve(this.layout.revisions, id);
  }

  async #readJson<T>(path: string, parse: (value: unknown) => T): Promise<T | undefined> {
    try {
      return parse(JSON.parse(await readFile(path, 'utf8')) as unknown);
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw new HarnessError({
        code: 'CONFIG_INVALID',
        message: `Invalid state file: ${path}`,
        cause: error,
      });
    }
  }

  async #writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    (error: unknown) => {
      if (isNotFound(error)) return false;
      throw error;
    },
  );
}
