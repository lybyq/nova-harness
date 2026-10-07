import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { FileStateStore } from '@nova-cbb/harness-installer';
import { HarnessError } from '@nova-cbb/harness-shared';

/**
 * 保存 CLI 当前 Runtime 选择。偏好位于 Harness 配置目录，不修改可共享的 Deployment Profile，
 * 因而同一份内网部署配置可供不同开发者选择各自已安装的 Runtime。
 */
export class RuntimePreferenceStore {
  readonly path = resolve(new FileStateStore().layout.config, 'runtime.json');

  /** 读取当前 Runtime；文件不存在时交由 Deployment Profile 提供默认值。 */
  async read(): Promise<string | undefined> {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8')) as { runtime?: unknown };
      return typeof value.runtime === 'string' ? value.runtime : undefined;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
      throw new HarnessError({
        code: 'CONFIG_INVALID',
        message: 'Runtime 偏好文件损坏',
        cause: error,
      });
    }
  }

  /** 读取持久化的 Integrated/Isolated 模式。 */
  async readMode(): Promise<'integrated' | 'isolated' | undefined> {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8')) as { mode?: unknown };
      return value.mode === 'integrated' || value.mode === 'isolated' ? value.mode : undefined;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
      throw new HarnessError({
        code: 'CONFIG_INVALID',
        message: 'Runtime 偏好文件损坏',
        cause: error,
      });
    }
  }

  /** 原子写入选择；1.0 仅允许已实现的 Claude Code Adapter。 */
  async use(
    runtime: string,
    mode?: 'integrated' | 'isolated',
  ): Promise<{ runtime: string; mode?: 'integrated' | 'isolated'; selected: true }> {
    if (runtime !== 'claude-code')
      throw new HarnessError({ code: 'NOT_FOUND', message: `Runtime ${runtime} 尚未安装适配器` });
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    try {
      const currentMode = mode ?? (await this.readMode());
      await writeFile(
        temporary,
        `${JSON.stringify({ runtime, ...(currentMode ? { mode: currentMode } : {}) }, null, 2)}\n`,
        { encoding: 'utf8', mode: 0o600 },
      );
      await rename(temporary, this.path);
    } finally {
      await rm(temporary, { force: true });
    }
    return { runtime, ...(mode ? { mode } : {}), selected: true };
  }
}
