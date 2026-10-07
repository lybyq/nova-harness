import { Injectable } from '@nestjs/common';
import { capabilitySchema } from '@nova-cbb/harness-contracts';
import { checksumOf, HarnessError } from '@nova-cbb/harness-shared';
import { GitLabSource } from '@nova-cbb/source-gitlab';
import { NpmSource } from '@nova-cbb/source-npm';
import type { Prisma } from '@prisma/client';
import { DeploymentService } from '../configuration/deployment.service.js';
import { EnvironmentSecretResolver } from '../configuration/environment-secret-resolver.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * 执行来源编辑、能力元数据覆盖、版本治理、兼容规则与脱敏审计。
 * 所有管理员写操作均持久化 before/after 摘要，且不接收 Secret 明文。
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deployment: DeploymentService,
    private readonly secrets: EnvironmentSecretResolver,
  ) {}
  /** 返回当前真正生效的 Deployment 来源配置。 */ async sources() {
    return (await this.deployment.get()).sources;
  }
  /** 更新来源并记录不含 Secret 值的审计日志。 */ async updateSource(id: string, value: unknown) {
    const before = (await this.deployment.get()).sources.find((item) => item.id === id);
    const after = await this.deployment.updateSource(id, value);
    await this.audit('source.update', 'source', id, before, after);
    return after;
  }
  /** 测试来源最小权限和连通性，不触发全量同步。 */ async testSource(id: string) {
    const source = (await this.deployment.get()).sources.find((item) => item.id === id);
    if (!source)
      throw new HarnessError({ code: 'NOT_FOUND', message: `Source ${id} was not found` });
    return source.type === 'gitlab'
      ? new GitLabSource({ config: source, secrets: this.secrets }).ping()
      : new NpmSource({ config: source, secrets: this.secrets }).ping();
  }
  /** 合并管理员覆盖层，保留来源层并重算 effectiveData。 */ async updateCapability(
    id: string,
    overrides: unknown,
  ) {
    if (!isRecord(overrides))
      throw new HarnessError({
        code: 'CONFIG_INVALID',
        message: 'Admin overrides must be an object',
      });
    const row = await this.prisma.capability.findUnique({ where: { id } });
    if (!row)
      throw new HarnessError({ code: 'NOT_FOUND', message: `Capability ${id} was not found` });
    const source = capabilitySchema.parse(row.effectiveData);
    const effective = capabilitySchema.parse({
      ...source,
      ...overrides,
      adminOverrides: overrides,
    });
    const updated = await this.prisma.capability.update({
      where: { id },
      data: {
        adminOverrides: toJson(overrides),
        effectiveData: toJson(effective),
        displayName: effective.displayName,
        description: effective.description,
        status: effective.status.replace('-', '_').toUpperCase() as never,
        riskLevel: effective.riskLevel.toUpperCase() as never,
        rowVersion: { increment: 1 },
      },
    });
    await this.audit('capability.update', 'capability', id, row.adminOverrides, overrides);
    return updated;
  }
  /** 设置唯一推荐版本。 */ async recommendVersion(id: string, version: string) {
    const target = await this.prisma.capabilityVersion.findUnique({
      where: { capabilityId_version: { capabilityId: id, version } },
    });
    if (!target)
      throw new HarnessError({ code: 'NOT_FOUND', message: `${id}@${version} was not found` });
    await this.prisma.$transaction([
      this.prisma.capabilityVersion.updateMany({
        where: { capabilityId: id },
        data: { recommended: false },
      }),
      this.prisma.capabilityVersion.update({
        where: { id: target.id },
        data: { recommended: true, rowVersion: { increment: 1 } },
      }),
    ]);
    await this.audit('version.recommend', 'capability-version', `${id}@${version}`, undefined, {
      recommended: true,
    });
    return { id, version, recommended: true };
  }
  /** 软删除版本，历史 Revision 仍可引用不可变 Store。 */ async disableVersion(
    id: string,
    version: string,
  ) {
    const updated = await this.prisma.capabilityVersion.update({
      where: { capabilityId_version: { capabilityId: id, version } },
      data: { deletedAt: new Date(), recommended: false, rowVersion: { increment: 1 } },
    });
    await this.audit('version.disable', 'capability-version', `${id}@${version}`, undefined, {
      disabled: true,
    });
    return updated;
  }
  /**
   * 更新指定版本的 Runtime Compatibility 覆盖层。
   * 只接受对象并合并进版本 metadata，不允许改写 integrity、commitSha 等来源事实。
   */
  async updateCompatibility(id: string, version: string, runtimeBindings: unknown) {
    if (!isRecord(runtimeBindings))
      throw new HarnessError({
        code: 'CONFIG_INVALID',
        message: 'runtimeBindings must be an object',
      });
    const current = await this.prisma.capabilityVersion.findUnique({
      where: { capabilityId_version: { capabilityId: id, version } },
    });
    if (!current)
      throw new HarnessError({ code: 'NOT_FOUND', message: `${id}@${version} was not found` });
    const metadata = isRecord(current.metadata) ? current.metadata : {};
    const updated = await this.prisma.capabilityVersion.update({
      where: { id: current.id },
      data: {
        metadata: toJson({ ...metadata, runtimeBindings }),
        rowVersion: { increment: 1 },
      },
    });
    await this.audit(
      'compatibility.update',
      'capability-version',
      `${id}@${version}`,
      metadata.runtimeBindings,
      runtimeBindings,
    );
    return updated;
  }
  /** 返回最近 200 条管理员审计。 */ audits() {
    return this.prisma.adminAuditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  }
  private audit(
    action: string,
    resourceType: string,
    resourceId: string,
    before: unknown,
    after: unknown,
  ) {
    return this.prisma.adminAuditLog.create({
      data: {
        actorId: 'hub-admin',
        action,
        resourceType,
        resourceId,
        ...(before === undefined ? {} : { before: toJson(before) }),
        ...(after === undefined ? {} : { after: toJson(after) }),
        requestId: checksumOf({ action, resourceId, at: Date.now() }).slice(0, 16),
      },
    });
  }
}
function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
