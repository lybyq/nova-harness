/** 以判别联合表达显式成功或失败，适合不应抛异常的边界 API。 */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** 创建成功 Result。 */
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
/** 创建失败 Result。 */
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/**
 * 执行异步操作并将异常转换为 Result，便于批量同步继续处理其他条目。
 * @param operation 可能抛出异常的异步操作。
 * @param mapError 将未知异常映射为领域错误的函数。
 * @returns 永不抛出、显式携带成功值或失败值的 Result。
 */
export async function capture<T, E>(
  operation: () => Promise<T>,
  mapError: (error: unknown) => E,
): Promise<Result<T, E>> {
  try {
    return ok(await operation());
  } catch (error) {
    return err(mapError(error));
  }
}
