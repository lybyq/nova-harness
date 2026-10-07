import { Module } from '@nestjs/common';
import { SyncController } from './sync.controller.js';
import { SyncService } from './sync.service.js';

/** 注册定时/手动同步引擎和查询控制器。 */
@Module({ controllers: [SyncController], providers: [SyncService] })
export class SyncModule {}
