import { Module } from '@nestjs/common';
import { ManifestsController } from './manifests.controller.js';
/** 注册 Manifest 在线校验与预览控制器。 */
@Module({ controllers: [ManifestsController] })
export class ManifestsModule {}
