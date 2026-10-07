import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
/** 注册 Hub Admin 所需的控制器和治理服务。 */
@Module({ controllers: [AdminController], providers: [AdminService] })
export class AdminModule {}
