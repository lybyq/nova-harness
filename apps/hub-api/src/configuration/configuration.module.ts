import { Global, Module } from '@nestjs/common';
import { DeploymentService } from './deployment.service.js';
import { EnvironmentSecretResolver } from './environment-secret-resolver.js';

/** 全局提供已校验 Deployment Profile 与只读环境 Secret 解析能力。 */
@Global()
@Module({
  providers: [DeploymentService, EnvironmentSecretResolver],
  exports: [DeploymentService, EnvironmentSecretResolver],
})
export class ConfigurationModule {}
