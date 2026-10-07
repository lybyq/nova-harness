import { createHash } from 'node:crypto';

/**
 * 将任意 JSON 兼容值转换为对象键稳定排序的文本。
 * @param value 待规范化的值。
 * @returns 可用于跨进程校验的确定性 JSON。
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

/**
 * 计算文本或字节数组的 SHA-256 十六进制摘要。
 * @param value 原始内容；调用方负责保证输入编码一致。
 * @returns 64 位小写十六进制摘要。
 */
export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * 对结构化值规范化后计算 SHA-256，用于 State 和 Plan 防漂移。
 * @param value JSON 兼容结构。
 * @returns 与对象键插入顺序无关的摘要。
 */
export function checksumOf(value: unknown): string {
  return sha256(canonicalJson(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortValue(item)]),
  );
}
