const secretKeyPattern =
  /(?:authorization|cookie|token|password|secret|private[-_]?token|auth[-_]?token|client[-_]?secret)/i;
const referenceKeyPattern = /(?:ref|refs|reference|references|key|keys|definition|definitions)$/i;

const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const urlCredentialPattern = /([a-z][a-z0-9+.-]*:\/\/[^\s:/?#]+:)([^\s@/?#]+)(@)/gi;

/**
 * 脱敏文本中的 Bearer Token 与 URL 密码。
 * @param value 可能进入终端或日志的文本。
 * @returns 不含已识别凭证内容的文本。
 */
export function redactString(value: string): string {
  return value
    .replace(bearerPattern, 'Bearer [REDACTED]')
    .replace(urlCredentialPattern, '$1[REDACTED]$3');
}

/**
 * 深度脱敏对象、数组和循环结构中的敏感字段。
 * @param value 待输出的任意结构；函数不会修改原对象。
 * @returns 保持泛型外形的脱敏副本。
 */
export function redact<T>(value: T): T {
  return redactValue(value, new WeakSet<object>()) as T;
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = isSensitiveValueKey(key) ? '[REDACTED]' : redactValue(item, seen);
  }
  return output;
}

function isSensitiveValueKey(key: string): boolean {
  if (referenceKeyPattern.test(key) || /^requiredSecrets$/i.test(key)) return false;
  return secretKeyPattern.test(key);
}
