import { asHarnessError, redact } from '@nova-cbb/harness-shared';
import type { HarnessError } from '@nova-cbb/harness-shared';
import pc from 'picocolors';
import { translate } from '../i18n/messages.js';

/** CLI 输出模式；JSON 与 quiet 在 TTY/CI 中保持确定语义。 */
export interface OutputOptions {
  json: boolean;
  color: boolean;
  quiet: boolean;
  locale?: 'zh-CN' | 'en-US';
}

/**
 * 唯一 CLI 输出边界。所有对象在序列化前执行递归脱敏，
 * JSON 错误仍写 stdout 便于自动化消费，人类错误写 stderr。
 */
export class Output {
  constructor(private readonly options: OutputOptions) {
    pc.isColorSupported = options.color;
  }

  result(value: unknown): void {
    if (this.options.quiet) return;
    if (this.options.json) {
      process.stdout.write(`${JSON.stringify(redact(value))}\n`);
      return;
    }
    if (typeof value === 'string') {
      process.stdout.write(`${value}\n`);
      return;
    }
    const safe = redact(value);
    process.stdout.write(`${renderHuman(safe, process.stdout.columns ?? 100)}\n`);
  }

  success(message: string): void {
    if (!this.options.quiet && !this.options.json)
      process.stdout.write(`${pc.green('✓')} ${message}\n`);
  }

  error(error: unknown): number {
    const harnessError = asHarnessError(error);
    const payload = {
      code: harnessError.code,
      message: harnessError.message,
      hint: harnessError.hint,
      details: redact(harnessError.details),
    };
    if (this.options.json) {
      process.stdout.write(`${JSON.stringify(payload)}\n`);
    } else {
      process.stderr.write(`${pc.red('×')} ${payload.message}\n`);
      if (payload.hint)
        process.stderr.write(`  ${translate(this.options.locale, 'nextStep')}：${payload.hint}\n`);
    }
    return exitCode(harnessError);
  }
}

/**
 * 对扁平数组使用自适应表格；窄终端切换逐项卡片，复杂对象保持格式化 JSON。
 * 这避免表格越界，同时不影响 `--json` 的稳定机器契约。
 */
function renderHuman(value: unknown, columns: number): string {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isFlatRecord))
    return JSON.stringify(value, null, 2);
  const keys = [...new Set(value.flatMap((item) => Object.keys(item)))];
  if (columns < 72)
    return value
      .map((item, index) =>
        [`#${index + 1}`, ...keys.map((key) => `${key}: ${display(item[key])}`)].join('\n'),
      )
      .join('\n\n');
  const available = Math.max(8, Math.floor((columns - keys.length - 1) / keys.length));
  const widths = keys.map((key) =>
    Math.min(available, Math.max(key.length, ...value.map((item) => display(item[key]).length))),
  );
  const row = (item: Record<string, unknown>) =>
    keys
      .map((key, index) => pad(truncate(display(item[key]), widths[index]!), widths[index]!))
      .join(' │ ');
  return [
    row(Object.fromEntries(keys.map((key) => [key, key]))),
    widths.map((width) => '─'.repeat(width)).join('─┼─'),
    ...value.map(row),
  ].join('\n');
}

function isFlatRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (item) => item === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof item),
    )
  );
}

function display(value: unknown): string {
  if (value === undefined) return '—';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
    return String(value);
  return JSON.stringify(value);
}

function truncate(value: string, width: number): string {
  return value.length <= width ? value : `${value.slice(0, Math.max(1, width - 1))}…`;
}

function pad(value: string, width: number): string {
  return value.padEnd(width, ' ');
}

function exitCode(error: HarnessError): number {
  switch (error.code) {
    case 'CONFIG_INVALID':
      return 2;
    case 'SOURCE_UNAVAILABLE':
      return 3;
    case 'AUTH_REQUIRED':
    case 'AUTH_INVALID':
    case 'PERMISSION_DENIED':
      return 4;
    case 'COMPATIBILITY_ERROR':
      return 5;
    case 'PLAN_CONFLICT':
      return 6;
    case 'APPLY_FAILED':
      return 7;
    case 'ROLLBACK_FAILED':
      return 8;
    case 'CANCELLED':
      return 10;
    default:
      return 1;
  }
}
