import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PUBLIC_ROUTE } from './public.decorator.js';

/** 开发 Token Bearer 守卫；生产可在不改 Controller 的前提下替换为 OIDC。 */
@Injectable()
/** 开发 Token Bearer 守卫；生产可在不改业务 Controller 的情况下替换为 OIDC 守卫。 */
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 内网首阶段默认免登录；需要恢复保护时只需设置 NOVA_HUB_AUTH_ENABLED=true。
    if (process.env.NOVA_HUB_AUTH_ENABLED !== 'true') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const expected = process.env.NOVA_HUB_DEV_TOKEN;
    if (!expected) {
      throw new UnauthorizedException('Hub authentication is not configured');
    }
    const request = context.switchToHttp().getRequest<Request>();
    const value = request.headers.authorization;
    if (value !== `Bearer ${expected}`) throw new UnauthorizedException('Invalid Hub token');
    return true;
  }
}
