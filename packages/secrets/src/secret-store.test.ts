import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EncryptedFileSecretStore } from './encrypted-file-store.js';
import { WindowsDpapiSecretStore } from './windows-dpapi-store.js';

describe('SecretStore', () => {
  it('使用 Master Password 加密保存并删除 Secret', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nova-secret-'));
    const store = new EncryptedFileSecretStore(
      join(root, 'vault.json'),
      async () => 'correct-horse-battery',
    );
    await store.set('JIRA_TOKEN', 'sensitive-value');
    expect(await store.get('JIRA_TOKEN')).toBe('sensitive-value');
    expect(await store.list()).toEqual(['JIRA_TOKEN']);
    await store.delete('JIRA_TOKEN');
    expect(await store.has('JIRA_TOKEN')).toBe(false);
  });

  it.runIf(process.platform === 'win32')(
    '使用 DPAPI CurrentUser 完成往返',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'nova-dpapi-'));
      const store = new WindowsDpapiSecretStore(join(root, 'vault.json'));
      await store.set('NPM_TOKEN', 'dpapi-sensitive');
      expect(await store.get('NPM_TOKEN')).toBe('dpapi-sensitive');
    },
    20_000,
  );
});
