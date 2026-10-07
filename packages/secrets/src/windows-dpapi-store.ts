import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { HarnessError } from '@nova-cbb/harness-shared';
import type { SecretStore } from './secret-store.js';

interface DpapiVault {
  version: 1;
  backend: 'windows-dpapi-current-user';
  entries: Record<string, string>;
}

/**
 * 使用 Windows DPAPI CurrentUser 范围保护 Secret。
 *
 * 磁盘只保存 DPAPI 密文；加解密脚本通过 stdin 接收数据，避免 Secret 出现在进程参数和进程列表中。
 * 密文只能由同一 Windows 用户解密，复制到其他账号或机器后不可用。
 */
export class WindowsDpapiSecretStore implements SecretStore {
  constructor(private readonly path: string) {
    if (process.platform !== 'win32')
      throw new HarnessError({
        code: 'COMPATIBILITY_ERROR',
        message: 'Windows DPAPI 仅可在 Windows 使用',
      });
  }
  /** @inheritdoc */ async get(key: string): Promise<string | undefined> {
    const value = (await this.#read()).entries[key.trim()];
    return value ? runDpapi('unprotect', value) : undefined;
  }
  /** @inheritdoc */ async set(key: string, value: string): Promise<void> {
    const vault = await this.#read();
    vault.entries[key.trim()] = await runDpapi('protect', value);
    await this.#write(vault);
  }
  /** @inheritdoc */ async delete(key: string): Promise<void> {
    const vault = await this.#read();
    delete vault.entries[key.trim()];
    await this.#write(vault);
  }
  /** @inheritdoc */ async has(key: string): Promise<boolean> {
    return (await this.#read()).entries[key.trim()] !== undefined;
  }
  /** @inheritdoc */ async list(): Promise<string[]> {
    return Object.keys((await this.#read()).entries).sort();
  }
  async #read(): Promise<DpapiVault> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as DpapiVault;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return { version: 1, backend: 'windows-dpapi-current-user', entries: {} };
      throw error;
    }
  }
  async #write(value: DpapiVault): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporary, this.path);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}

/** 调用固定 DPAPI 脚本，Secret 只通过 stdin 传输。 */
function runDpapi(mode: 'protect' | 'unprotect', input: string): Promise<string> {
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); if('${mode}' -eq 'protect'){ $b=[Text.Encoding]::UTF8.GetBytes($v); $o=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($o)) } else { $b=[Convert]::FromBase64String($v); $o=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($o)) }`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );
    let output = '';
    let errorOutput = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      errorOutput += chunk.toString();
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolvePromise(output);
      else
        reject(
          new HarnessError({
            code: 'AUTH_INVALID',
            message: 'Windows DPAPI 操作失败',
            details: { exitCode: code, stderr: errorOutput.slice(0, 300) },
          }),
        );
    });
    child.stdin.end(input);
  });
}
