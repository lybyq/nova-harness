import { readFile } from 'node:fs/promises';
import { password } from '@clack/prompts';
import { HarnessError } from '@nova-cbb/harness-shared';
import type { EnvironmentSecrets } from '../config/environment-secrets.js';

/**
 * 隐藏读取 Secret 并清理剪贴板常见的首尾换行。
 * 非交互模式只接受 stdin，故 Secret 不会出现在 shell history 或进程参数中。
 */
export async function readSecretInput(key: string): Promise<{ value: string; trimmed: boolean }> {
  let raw: string;
  if (process.stdin.isTTY && process.env.NOVA_NON_INTERACTIVE !== 'yes') {
    const answer = await password({ message: `请输入 ${key}`, mask: '•' });
    if (typeof answer !== 'string')
      throw new HarnessError({ code: 'CANCELLED', message: '已取消 Secret 输入' });
    raw = answer;
  } else if (process.stdin.isTTY) {
    throw new HarnessError({
      code: 'CONFIG_INVALID',
      message: `非交互模式缺少 Secret：${key}`,
      hint: `将值通过 stdin 传给 nova secret set ${key}`,
      details: { missing: [key] },
    });
  } else raw = await readStdin();
  const value = raw.trim();
  if (!value) throw new HarnessError({ code: 'CONFIG_INVALID', message: 'Secret 不能为空' });
  return { value, trimmed: value !== raw };
}

/** 导入 dotenv 文件；只接受合法键名，不执行变量展开或 shell 表达式。 */
export async function importEnvFile(
  path: string,
  secrets: EnvironmentSecrets,
): Promise<{ imported: string[] }> {
  const content = await readFile(path, 'utf8');
  const imported: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match)
      throw new HarnessError({
        code: 'CONFIG_INVALID',
        message: `无法解析 .env 行：${trimmed.slice(0, 40)}`,
      });
    const key = match[1]!;
    const value = unquote(match[2]!.trim());
    if (!value) continue;
    await secrets.set(key, value);
    imported.push(key);
  }
  return { imported };
}

/** 验证能力声明的所有必需 Secret 是否已配置，不回显值。 */
export async function testCapabilitySecrets(required: string[], secrets: EnvironmentSecrets) {
  const missing: string[] = [];
  for (const key of required) if (!(await secrets.has(key))) missing.push(key);
  return { status: missing.length ? 'configuration-incomplete' : 'configured', required, missing };
}
function unquote(value: string): string {
  return value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
    ? value.slice(1, -1)
    : value;
}
function readStdin(): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let value = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      value += chunk;
    });
    process.stdin.once('end', () => resolvePromise(value));
    process.stdin.once('error', reject);
  });
}
