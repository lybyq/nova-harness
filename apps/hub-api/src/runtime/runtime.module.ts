import { Module } from '@nestjs/common';
import { RuntimeController } from './runtime.controller.js';
/** 注册 Runtime Marketplace 控制器。 */
@Module({ controllers: [RuntimeController] })
export class RuntimeModule {}
