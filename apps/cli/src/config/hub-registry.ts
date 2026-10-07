import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { FileStateStore } from '@nova-cbb/harness-installer';
import { HarnessError } from '@nova-cbb/harness-shared';
import { parse, stringify } from 'yaml';
import { z } from 'zod';

const registrySchema = z.object({
  version: z.literal(1),
  active: z.string().optional(),
  hubs: z
    .record(z.string(), z.object({ url: z.string().url(), authRef: z.string().optional() }))
    .default({}),
});
/** 用户级 Hub 别名、活动项和 Secret 引用的持久化类型。 */
export type HubRegistry = z.infer<typeof registrySchema>;

/** 管理用户级 Hub 别名；文件只保存 URL 和 Secret 引用，不保存 Token。 */
export class HubRegistryStore {
  readonly path = resolve(new FileStateStore().layout.config, 'hubs.yaml');
  /** 读取 Registry；首次使用返回空 Registry。 */
  async read(): Promise<HubRegistry> {
    try {
      return registrySchema.parse(parse(await readFile(this.path, 'utf8')) as unknown);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return { version: 1, hubs: {} };
      throw new HarnessError({
        code: 'CONFIG_INVALID',
        message: `Hub Registry 无效：${this.path}`,
        cause: error,
      });
    }
  }
  /** 原子保存 Registry。 */
  async write(value: HubRegistry): Promise<void> {
    const checked = registrySchema.parse(value);
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    try {
      await writeFile(temporary, stringify(checked), { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, this.path);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
  /**
   * 新增或更新 Hub 别名。
   * `authRef` 不传时按匿名 Hub 保存，适合可信内网的开放访问模式；部署方启用鉴权后，
   * 再通过 `--auth-ref` 显式声明 Secret 引用，避免 CLI 为开放 Hub 虚构一个必填凭据。
   */
  async add(name: string, url: string, authRef?: string) {
    const registry = await this.read();
    registry.hubs[name] = { url: new URL(url).toString().replace(/\/$/, ''), authRef };
    registry.active ??= name;
    await this.write(registry);
    return registry;
  }
  /** 删除 Hub；若它是当前项则清除 active。 */
  async remove(name: string) {
    const registry = await this.read();
    delete registry.hubs[name];
    if (registry.active === name) delete registry.active;
    await this.write(registry);
    return registry;
  }
  /** 切换当前 Hub，未知别名会失败。 */
  async use(name: string) {
    const registry = await this.read();
    if (!registry.hubs[name])
      throw new HarnessError({ code: 'NOT_FOUND', message: `Hub ${name} 不存在` });
    registry.active = name;
    await this.write(registry);
    return registry;
  }
}
