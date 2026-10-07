import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth/auth.guard.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { ConfigurationModule } from './configuration/configuration.module.js';
import { HealthController } from './health/health.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ResolveModule } from './resolve/resolve.module.js';
import { RolesModule } from './roles/roles.module.js';
import { RuntimeModule } from './runtime/runtime.module.js';
import { ManifestsModule } from './manifests/manifests.module.js';
import { SyncModule } from './sync/sync.module.js';
import { AdminModule } from './admin/admin.module.js';

/** 组合 Hub 的配置、目录、同步、角色、解析、Runtime 和管理治理模块。 */
@Module({
  imports: [
    PrismaModule,
    ConfigurationModule,
    CatalogModule,
    SyncModule,
    RolesModule,
    ResolveModule,
    RuntimeModule,
    ManifestsModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
