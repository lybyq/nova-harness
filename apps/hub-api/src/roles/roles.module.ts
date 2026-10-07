import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller.js';
import { RolesService } from './roles.service.js';
/** 注册并导出角色版本和发布服务。 */
@Module({ controllers: [RolesController], providers: [RolesService], exports: [RolesService] })
export class RolesModule {}
