import { resolve } from 'node:path';
import type { HarnessLayout } from '@nova-cbb/harness-installer';
import { EncryptedFileSecretStore } from './encrypted-file-store.js';
import type { MasterPasswordProvider, SecretStore } from './secret-store.js';
import { WindowsDpapiSecretStore } from './windows-dpapi-store.js';

/**
 * 按平台创建首选 Secret Store。
 *
 * Windows 默认使用 DPAPI；其他平台使用需要 Master Password 的 AES-GCM Vault。
 * 后续 macOS Keychain/Linux Secret Service 适配器可在此处插入而不影响调用方。
 */
export function createSecretStore(
  layout: HarnessLayout,
  passwordProvider: MasterPasswordProvider,
): SecretStore {
  return process.platform === 'win32'
    ? new WindowsDpapiSecretStore(resolve(layout.config, 'secrets.dpapi.json'))
    : new EncryptedFileSecretStore(resolve(layout.config, 'secrets.vault.json'), passwordProvider);
}
