/**
 * Secret Store 的最小可插拔契约。
 *
 * 实现不得把 Secret 写入日志、异常详情或命令行参数；`list` 只返回键名。
 */
export interface SecretStore {
  /** 读取 Secret；不存在时返回 `undefined`。 */
  get(key: string): Promise<string | undefined>;
  /** 新增或覆盖 Secret。 */
  set(key: string, value: string): Promise<void>;
  /** 删除 Secret；键不存在时保持幂等。 */
  delete(key: string): Promise<void>;
  /** 判断 Secret 是否存在。 */
  has(key: string): Promise<boolean>;
  /** 列出键名，不返回 Secret 值。 */
  list(): Promise<string[]>;
}

/** Master Password 的延迟提供器，避免无加密回退时仍向用户索取密码。 */
export type MasterPasswordProvider = () => Promise<string>;
