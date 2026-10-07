import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCallback,
} from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { HarnessError } from '@nova-cbb/harness-shared';
import type { MasterPasswordProvider, SecretStore } from './secret-store.js';

const scrypt = promisify(scryptCallback);
interface VaultFile {
  version: 1;
  salt: string;
  entries: Record<string, { iv: string; tag: string; ciphertext: string }>;
}

/**
 * 使用 AES-256-GCM 的本地加密回退 Store。
 *
 * 每个条目使用独立随机 IV，文件使用随机 Salt 通过 scrypt 派生密钥。Master Password
 * 只保留在当前进程内存中，不写入磁盘。认证标签校验失败统一报告“密码或密文无效”，避免泄露细节。
 */
export class EncryptedFileSecretStore implements SecretStore {
  #derivedKey?: Buffer;
  constructor(
    private readonly path: string,
    private readonly passwordProvider: MasterPasswordProvider,
  ) {}

  /** @inheritdoc */
  async get(key: string): Promise<string | undefined> {
    const vault = await this.#read();
    const entry = vault.entries[normalizeKey(key)];
    if (!entry) return undefined;
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        await this.#key(vault),
        Buffer.from(entry.iv, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(entry.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch (error) {
      throw new HarnessError({
        code: 'AUTH_INVALID',
        message: 'Master Password 错误或 Secret Vault 已损坏',
        cause: error,
      });
    }
  }

  /** @inheritdoc */
  async set(key: string, value: string): Promise<void> {
    const normalized = normalizeKey(key);
    if (!value) throw new HarnessError({ code: 'CONFIG_INVALID', message: 'Secret 不能为空' });
    const vault = await this.#read();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', await this.#key(vault), iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    vault.entries[normalized] = {
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
    await this.#write(vault);
  }

  /** @inheritdoc */
  async delete(key: string): Promise<void> {
    const vault = await this.#read();
    delete vault.entries[normalizeKey(key)];
    await this.#write(vault);
  }
  /** @inheritdoc */
  async has(key: string): Promise<boolean> {
    return (await this.#read()).entries[normalizeKey(key)] !== undefined;
  }
  /** @inheritdoc */
  async list(): Promise<string[]> {
    return Object.keys((await this.#read()).entries).sort();
  }

  async #read(): Promise<VaultFile> {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8')) as Partial<VaultFile>;
      if (value.version !== 1 || typeof value.salt !== 'string' || !isRecord(value.entries))
        throw new Error('invalid vault');
      return value as VaultFile;
    } catch (error) {
      if (isNotFound(error))
        return { version: 1, salt: randomBytes(16).toString('base64'), entries: {} };
      throw new HarnessError({
        code: 'CONFIG_INVALID',
        message: `Secret Vault 无法读取：${this.path}`,
        cause: error,
      });
    }
  }

  async #key(vault: VaultFile): Promise<Buffer> {
    if (!this.#derivedKey) {
      const password = await this.passwordProvider();
      if (password.length < 10)
        throw new HarnessError({
          code: 'CONFIG_INVALID',
          message: 'Master Password 至少需要 10 个字符',
        });
      this.#derivedKey = (await scrypt(password, Buffer.from(vault.salt, 'base64'), 32)) as Buffer;
    }
    return this.#derivedKey;
  }
  async #write(vault: VaultFile): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(vault, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporary, this.path);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}

function normalizeKey(key: string): string {
  const value = key.trim();
  if (!/^[A-Za-z][A-Za-z0-9_.-]{1,127}$/.test(value))
    throw new HarnessError({ code: 'CONFIG_INVALID', message: `Secret 键名无效：${value}` });
  return value;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
