import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { capabilitySchema, type Capability } from '@nova-cbb/harness-contracts';
import { FileStateStore } from '@nova-cbb/harness-installer';

/**
 * 保存用户显式信任的本地目录能力定义。该文件不含 Secret，且仅作为 Hub Catalog 的本机补充层；
 * 同 ID 的本地定义不会静默覆盖 Hub 定义，只有 `add ./path --allow-untrusted` 才会写入。
 */
export class LocalCatalogStore {
  readonly path = resolve(new FileStateStore().layout.config, 'local-catalog.json');

  /** 读取并逐项校验本地定义；损坏内容会直接报错而不是静默忽略。 */
  async list(): Promise<Capability[]> {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8')) as unknown;
      return Array.isArray(value) ? value.map((item) => capabilitySchema.parse(item)) : [];
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
      throw error;
    }
  }

  /** 按 ID 读取本地能力。 */
  async get(id: string): Promise<Capability | undefined> {
    return (await this.list()).find((item) => item.id === id);
  }

  /** 原子 Upsert 本地能力定义。 */
  async put(capability: Capability): Promise<void> {
    const items = [...(await this.list()).filter((item) => item.id !== capability.id), capability];
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(items, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporary, this.path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
