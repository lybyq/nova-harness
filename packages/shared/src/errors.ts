/** CLI、Core 与 Hub 共享的稳定机器错误码。 */
export type HarnessErrorCode =
  | 'CONFIG_INVALID'
  | 'SOURCE_UNAVAILABLE'
  | 'AUTH_REQUIRED'
  | 'AUTH_INVALID'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'COMPATIBILITY_ERROR'
  | 'PLAN_CONFLICT'
  | 'PLAN_STALE'
  | 'APPLY_FAILED'
  | 'ROLLBACK_FAILED'
  | 'INTEGRITY_FAILED'
  | 'UNTRUSTED_SOURCE'
  | 'CANCELLED'
  | 'INTERNAL_ERROR';

/** 创建 HarnessError 时可安全展示和审计的结构化字段。 */
export interface HarnessErrorOptions {
  code: HarnessErrorCode;
  message: string;
  hint?: string;
  cause?: unknown;
  details?: Record<string, unknown>;
  retryable?: boolean;
}

/**
 * 跨层传播的领域错误；details 不应包含 Secret，最终输出仍会经过 Redactor。
 */
export class HarnessError extends Error {
  readonly code: HarnessErrorCode;
  readonly hint: string | undefined;
  readonly details: Readonly<Record<string, unknown>>;
  readonly retryable: boolean;

  constructor(options: HarnessErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'HarnessError';
    this.code = options.code;
    this.hint = options.hint;
    this.details = Object.freeze({ ...(options.details ?? {}) });
    this.retryable = options.retryable ?? false;
  }
}

/**
 * 将未知异常收敛为稳定领域错误，避免 CLI 暴露不可预测异常结构。
 * @param error 捕获到的任意异常值。
 * @returns 原 HarnessError 或包装后的 INTERNAL_ERROR。
 */
export function asHarnessError(error: unknown): HarnessError {
  if (error instanceof HarnessError) return error;
  if (error instanceof Error) {
    return new HarnessError({
      code: 'INTERNAL_ERROR',
      message: error.message,
      cause: error,
    });
  }
  return new HarnessError({
    code: 'INTERNAL_ERROR',
    message: 'Unknown error',
    details: { valueType: typeof error },
  });
}
