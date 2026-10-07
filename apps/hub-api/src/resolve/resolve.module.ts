import { Module } from '@nestjs/common';
import { RolesModule } from '../roles/roles.module.js';
import { ResolveController } from './resolve.controller.js';
import { ResolveService } from './resolve.service.js';
/** 注册角色解析端点及其对 Roles 模块的依赖。 */
@Module({ imports: [RolesModule], controllers: [ResolveController], providers: [ResolveService] })
export class ResolveModule {}
