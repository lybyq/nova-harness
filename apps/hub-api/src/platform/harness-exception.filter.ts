import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus } from '@nestjs/common';
import { HarnessError, redact } from '@nova-cbb/harness-shared';
import type { Response } from 'express';

/** 将领域错误稳定映射为 HTTP 状态和脱敏 JSON，未知异常统一返回 500。 */
@Catch()
/** 把领域错误稳定映射为 HTTP 状态与脱敏 JSON，未知异常统一返回 500。 */
export class HarnessExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof HttpException) {
      response.status(error.getStatus()).json(error.getResponse());
      return;
    }
    if (error instanceof HarnessError) {
      response.status(statusFor(error)).json({
        code: error.code,
        message: error.message,
        hint: error.hint,
        retryable: error.retryable,
        details: redact(error.details),
      });
      return;
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: 'INTERNAL_ERROR',
      message,
    });
  }
}

function statusFor(error: HarnessError): number {
  switch (error.code) {
    case 'NOT_FOUND':
      return HttpStatus.NOT_FOUND;
    case 'AUTH_REQUIRED':
    case 'AUTH_INVALID':
      return HttpStatus.UNAUTHORIZED;
    case 'PERMISSION_DENIED':
      return HttpStatus.FORBIDDEN;
    case 'CONFIG_INVALID':
    case 'PLAN_CONFLICT':
    case 'COMPATIBILITY_ERROR':
      return HttpStatus.UNPROCESSABLE_ENTITY;
    case 'SOURCE_UNAVAILABLE':
      return HttpStatus.BAD_GATEWAY;
    default:
      return HttpStatus.INTERNAL_SERVER_ERROR;
  }
}
