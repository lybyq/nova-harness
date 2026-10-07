import { password } from '@clack/prompts';
import { FileStateStore } from '@nova-cbb/harness-installer';
import { createSecretStore, type SecretStore } from '@nova-cbb/harness-secrets';
import { HarnessError } from '@nova-cbb/harness-shared';

/**
 * CLI 的统一 Secret 解析器。
 *
 * 环境变量优先于持久 Store，便于 CI 和一次性会话覆盖；持久层在 Windows 使用 DPAPI，
 * 其他平台使用 Master Password 加密 Vault。调用方永远不需要知道实际后端。
 */
export class EnvironmentSecrets {
  readonly #store: SecretStore;
  constructor() {
    this.#store = createSecretStore(new FileStateStore().layout, masterPassword);
  }

  /** 按原名和规范化的 `NOVA_SECRET_*` 环境变量解析，最后查询安全 Store。 */
  async get(reference: string): Promise<string | undefined> {
    const normalized = `NOVA_SECRET_${reference.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`;
    return process.env[reference] ?? process.env[normalized] ?? this.#store.get(reference);
  }
  /** 安全持久化 Secret。 */
  set(reference: string, value: string): Promise<void> {
    return this.#store.set(reference, value);
  }
  /** 删除持久化 Secret，不影响当前进程环境变量。 */
  delete(reference: string): Promise<void> {
    return this.#store.delete(reference);
  }
  /** 仅列出持久化键名。 */
  list(): Promise<string[]> {
    return this.#store.list();
  }
  /** 判断环境或持久层是否存在该键。 */
  async has(reference: string): Promise<boolean> {
    return (await this.get(reference)) !== undefined;
  }
}

/** 仅在加密回退真正需要时请求 Master Password。 */
async function masterPassword(): Promise<string> {
  if (process.env.NOVA_MASTER_PASSWORD) return process.env.NOVA_MASTER_PASSWORD;
  if (!process.stdin.isTTY)
    throw new HarnessError({
      code: 'AUTH_REQUIRED',
      message: '非交互环境需要设置 NOVA_MASTER_PASSWORD',
    });
  const value = await password({ message: '请输入 Nova Harness Master Password', mask: '•' });
  if (typeof value !== 'string')
    throw new HarnessError({ code: 'AUTH_REQUIRED', message: '已取消输入 Master Password' });
  return value;
}
