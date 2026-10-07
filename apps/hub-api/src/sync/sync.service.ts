import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Capability, CatalogSourceConfig } from '@nova-cbb/harness-contracts';
import { checksumOf, HarnessError, redact } from '@nova-cbb/harness-shared';
import { GitLabSource, type DiscoveredGitLabProject } from '@nova-cbb/source-gitlab';
import { NpmSource } from '@nova-cbb/source-npm';
import type { Prisma } from '@prisma/client';
import { parse } from 'yaml';
import { DeploymentService } from '../configuration/deployment.service.js';
import { EnvironmentSecretResolver } from '../configuration/environment-secret-resolver.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Catalog 同步应用服务。每个 Source 使用 PostgreSQL advisory lock 防重入，
 * 成功整轮才软删除未再发现条目，失败保留 SyncRun 与脱敏错误用于审计。
 * 服务启动后依据 Deployment Profile 的六段 schedule 建立轻量定时器；数据库 advisory lock
 * 保证多 Hub 实例不会重复同步同一 Source。单项入库失败会记录 SyncItem 并继续其余条目。
 */
@Injectable()
export class SyncService implements OnModuleInit, OnModuleDestroy {
  #timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly deployment: DeploymentService,
    private readonly secrets: EnvironmentSecretResolver,
  ) {}

  /** 按配置并发度同步所有启用来源，单一来源失败不会阻断其他来源。 */
  async runAll() {
    const profile = await this.deployment.get();
    return this.#runSources(
      profile.sources.filter((item) => item.enabled),
      profile.sync.concurrency,
    );
  }

  /** 同步某一类型的所有启用来源。 */
  async runType(type: 'gitlab' | 'npm') {
    const profile = await this.deployment.get();
    const sources = profile.sources.filter((item) => item.enabled && item.type === type);
    if (sources.length === 0) {
      throw new HarnessError({
        code: 'NOT_FOUND',
        message: `No enabled ${type} source is configured`,
      });
    }
    return this.#runSources(sources, profile.sync.concurrency);
  }

  /** 同步指定来源，供 Admin 对单个 GitLab Group 或 Registry 做修复性重跑。 */
  async runSource(id: string) {
    const profile = await this.deployment.get();
    const source = profile.sources.find((item) => item.enabled && item.id === id);
    if (!source)
      throw new HarnessError({ code: 'NOT_FOUND', message: `Source ${id} was not found` });
    return this.#syncSource(source);
  }

  /** 初始化定时同步；定时器 unref，避免阻止测试或优雅退出。 */
  async onModuleInit(): Promise<void> {
    if (process.env.NOVA_SYNC_DISABLED === 'yes') return;
    const profile = await this.deployment.get();
    const interval = scheduleIntervalMs(profile.sync.schedule);
    this.#timer = setInterval(() => {
      void this.runAll().catch((error) => {
        console.error('[nova-hub] scheduled sync failed', redact(errorDetails(error)));
      });
    }, interval);
    this.#timer.unref();
  }

  /** 停止定时器，确保 NestJS 热重载和容器退出不残留任务。 */
  onModuleDestroy(): void {
    if (this.#timer) clearInterval(this.#timer);
  }

  runs() {
    return this.prisma.syncRun.findMany({ orderBy: { startedAt: 'desc' }, take: 100 });
  }

  async run(id: string) {
    const run = await this.prisma.syncRun.findUnique({ where: { id }, include: { items: true } });
    if (!run)
      throw new HarnessError({ code: 'NOT_FOUND', message: `Sync run ${id} was not found` });
    return run;
  }

  async #syncSource(source: CatalogSourceConfig) {
    await this.#upsertSource(source);
    const locked = await this.#acquireLock(source.id);
    if (!locked) {
      throw new HarnessError({
        code: 'PLAN_CONFLICT',
        message: `Source ${source.id} is already being synchronized`,
      });
    }
    const run = await this.prisma.syncRun.create({ data: { sourceId: source.id, fullSync: true } });
    try {
      const capabilities =
        source.type === 'npm'
          ? (await new NpmSource({ config: source, secrets: this.secrets }).discover()).map(
              (item) => item.capability,
            )
          : (await new GitLabSource({ config: source, secrets: this.secrets }).discover()).map(
              (item) => gitLabCapability(source.id, item),
            );

      let created = 0;
      let updated = 0;
      let failed = 0;
      for (const capability of capabilities) {
        try {
          const existed = await this.prisma.capability.count({ where: { id: capability.id } });
          await this.#upsertCapability(capability, run.id);
          await this.prisma.syncItem.create({
            data: {
              syncRunId: run.id,
              capabilityId: capability.id,
              locator: capability.source.locator,
              action: existed ? 'update' : 'create',
              status: 'succeeded',
            },
          });
          if (existed) updated += 1;
          else created += 1;
        } catch (error) {
          failed += 1;
          await this.prisma.syncItem.create({
            data: {
              syncRunId: run.id,
              capabilityId: capability.id,
              locator: capability.source.locator,
              action: 'upsert',
              status: 'failed',
              message: JSON.stringify(redact(errorDetails(error))).slice(0, 2_000),
            },
          });
        }
      }

      if (failed === 0)
        await this.prisma.capability.updateMany({
          where: { sourceId: source.id, NOT: { lastSeenSyncId: run.id }, deletedAt: null },
          data: { deletedAt: new Date(), rowVersion: { increment: 1 } },
        });
      return await this.prisma.syncRun.update({
        where: { id: run.id },
        data: {
          status: failed === 0 ? 'SUCCEEDED' : 'PARTIAL',
          discovered: capabilities.length,
          created,
          updated,
          failed,
          finishedAt: new Date(),
        },
      });
    } catch (error) {
      await this.prisma.syncRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          failed: 1,
          error: toJson(redact(errorDetails(error))),
          finishedAt: new Date(),
        },
      });
      throw error;
    } finally {
      await this.#releaseLock(source.id);
    }
  }

  async #upsertSource(source: CatalogSourceConfig): Promise<void> {
    const secretRefs = source.authRef ? [source.authRef] : [];
    await this.prisma.catalogSource.upsert({
      where: { id: source.id },
      create: {
        id: source.id,
        displayName: source.displayName,
        type: source.type === 'npm' ? 'NPM' : 'GITLAB',
        enabled: source.enabled,
        config: toJson(source),
        secretRefs: toJson(secretRefs),
      },
      update: {
        displayName: source.displayName,
        enabled: source.enabled,
        config: toJson(source),
        secretRefs: toJson(secretRefs),
        deletedAt: null,
        rowVersion: { increment: 1 },
      },
    });
  }

  async #upsertCapability(capability: Capability, syncRunId: string): Promise<void> {
    const existing = await this.prisma.capability.findUnique({ where: { id: capability.id } });
    const effective = {
      ...capability,
      ...(isRecord(existing?.adminOverrides) ? existing.adminOverrides : {}),
    };
    await this.prisma.$transaction(async (transaction) => {
      await transaction.capability.upsert({
        where: { id: capability.id },
        create: {
          id: capability.id,
          type: capability.type.toUpperCase() as never,
          name: capability.name,
          displayName: capability.displayName,
          description: capability.description,
          tags: toJson(capability.tags),
          categories: toJson(capability.categories),
          maintainers: toJson(capability.maintainers),
          status: capability.status.replace('-', '_').toUpperCase() as never,
          riskLevel: capability.riskLevel.toUpperCase() as never,
          sourceId: capability.source.sourceId,
          sourceLocator: capability.source.locator,
          sourceMetadata: toJson(capability.sourceMetadata),
          effectiveData: toJson(effective),
          lastSeenSyncId: syncRunId,
        },
        update: {
          name: capability.name,
          displayName: capability.displayName,
          description: capability.description,
          tags: toJson(capability.tags),
          categories: toJson(capability.categories),
          maintainers: toJson(capability.maintainers),
          status: capability.status.replace('-', '_').toUpperCase() as never,
          riskLevel: capability.riskLevel.toUpperCase() as never,
          sourceId: capability.source.sourceId,
          sourceLocator: capability.source.locator,
          sourceMetadata: toJson(capability.sourceMetadata),
          effectiveData: toJson(effective),
          lastSeenSyncId: syncRunId,
          deletedAt: null,
          rowVersion: { increment: 1 },
        },
      });
      await transaction.capabilityVersion.updateMany({
        where: { capabilityId: capability.id },
        data: { recommended: false },
      });
      for (const version of capability.versions) {
        await transaction.capabilityVersion.upsert({
          where: {
            capabilityId_version: { capabilityId: capability.id, version: version.version },
          },
          create: {
            capabilityId: capability.id,
            version: version.version,
            recommended: version.recommended,
            commitSha: version.commitSha ?? null,
            integrity: version.integrity ?? null,
            archiveSha256: version.archiveSha256 ?? null,
            manifestChecksum: version.manifestChecksum,
            metadata: toJson(version),
          },
          update: {
            recommended: version.recommended,
            commitSha: version.commitSha ?? null,
            integrity: version.integrity ?? null,
            archiveSha256: version.archiveSha256 ?? null,
            manifestChecksum: version.manifestChecksum,
            metadata: toJson(version),
            deletedAt: null,
            rowVersion: { increment: 1 },
          },
        });
      }
    });
  }

  async #acquireLock(sourceId: string): Promise<boolean> {
    const result = await this.prisma.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_lock(hashtext(${`nova-sync:${sourceId}`})) AS locked
    `;
    return result[0]?.locked ?? false;
  }

  async #releaseLock(sourceId: string): Promise<void> {
    await this.prisma.$queryRaw`
      SELECT pg_advisory_unlock(hashtext(${`nova-sync:${sourceId}`}))
    `;
  }

  async #runSources(sources: CatalogSourceConfig[], concurrency: number) {
    const results: unknown[] = new Array(sources.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < sources.length) {
        const index = cursor++;
        const source = sources[index]!;
        try {
          results[index] = await this.#syncSource(source);
        } catch (error) {
          results[index] = {
            sourceId: source.id,
            status: 'FAILED',
            error: redact(errorDetails(error)),
          };
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, sources.length) }, async () => worker()),
    );
    return results;
  }
}

/**
 * 将常用六段 Cron（秒、分钟）转换成固定间隔。
 * 当前支持每秒、每分钟与每 N 分钟三种常用形式；其他表达式安全回退 30 分钟，
 * 避免错误配置形成高频同步风暴。
 */
function scheduleIntervalMs(schedule: string): number {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 6) return 30 * 60_000;
  if (fields[0] === '*' && fields[1] === '*') return 1_000;
  if (fields[0] === '0' && fields[1] === '*') return 60_000;
  const match = /^\*\/(\d+)$/.exec(fields[1]!);
  if (fields[0] === '0' && match) {
    const minutes = Number(match[1]);
    if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 59) return minutes * 60_000;
  }
  return 30 * 60_000;
}

function gitLabCapability(sourceId: string, item: DiscoveredGitLabProject): Capability {
  const document: unknown = item.manifestContent ? parse(item.manifestContent) : undefined;
  const metadata = isRecord(document) && isRecord(document.metadata) ? document.metadata : {};
  const id = typeof metadata.id === 'string' ? metadata.id : item.project.path;
  const displayName =
    typeof metadata.displayName === 'string' ? metadata.displayName : item.project.name;
  const description =
    typeof metadata.description === 'string'
      ? metadata.description
      : (item.project.description ?? item.readmeSummary ?? '');
  const tags = Array.isArray(metadata.tags)
    ? metadata.tags.filter((value): value is string => typeof value === 'string')
    : (item.project.topics ?? []);
  const taggedVersions = item.tags
    .map((tag) => ({ tag, version: tag.name.replace(/^v/, '') }))
    .filter(({ version }) => /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version));
  const versions =
    taggedVersions.length > 0
      ? taggedVersions.map(({ tag, version }, index) => ({
          version,
          recommended: index === 0,
          commitSha: tag.commit?.id ?? tag.target,
          artifact: {
            kind: 'gitlab-archive' as const,
            url: `${sourceBaseUrl(sourceId, item)}/api/v4/projects/${item.project.id}/repository/archive.tar.gz?sha=${encodeURIComponent(tag.commit?.id ?? tag.target)}`,
            ...(item.entryPath ? { entryPath: item.entryPath } : {}),
          },
          manifestChecksum: checksumOf(item.manifestContent ?? {}),
          dependencies: [],
          conflicts: [],
          runtimeBindings: {},
        }))
      : [
          {
            version: `0.0.0-${item.defaultBranchCommitSha.slice(0, 12)}`,
            recommended: true,
            commitSha: item.defaultBranchCommitSha,
            artifact: {
              kind: 'gitlab-archive' as const,
              url: `${sourceBaseUrl(sourceId, item)}/api/v4/projects/${item.project.id}/repository/archive.tar.gz?sha=${encodeURIComponent(item.defaultBranchCommitSha)}`,
              ...(item.entryPath ? { entryPath: item.entryPath } : {}),
            },
            manifestChecksum: checksumOf(item.manifestContent ?? {}),
            dependencies: [],
            conflicts: [],
            runtimeBindings: {},
          },
        ];

  return {
    id,
    type: item.capabilityType,
    name: item.project.path,
    displayName,
    description,
    tags,
    categories: [],
    maintainers: item.maintainers.map((member) => ({ name: member.name })),
    status: item.manifestContent && item.entryExists ? 'active' : 'needs-review',
    riskLevel: 'medium',
    source: {
      sourceId,
      kind: 'gitlab',
      locator: item.project.path_with_namespace,
      projectId: item.project.id,
    },
    versions,
    secrets: [],
    configuration: [],
    sourceMetadata: {
      entryPath: item.entryPath,
      entryExists: item.entryExists,
      visibility: item.project.visibility,
      webUrl: item.project.web_url,
      lastActivityAt: item.project.last_activity_at,
      maintainers: item.maintainers,
    },
    adminOverrides: {},
  };
}

function sourceBaseUrl(sourceId: string, item: DiscoveredGitLabProject): string {
  const webUrl = new URL(item.project.web_url);
  if (!webUrl.hostname)
    throw new HarnessError({
      code: 'CONFIG_INVALID',
      message: `GitLab source ${sourceId} has no valid origin`,
    });
  return webUrl.origin;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof HarnessError) {
    return { code: error.code, message: error.message, details: error.details };
  }
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { type: typeof error };
}
