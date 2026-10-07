import { Injectable } from '@nestjs/common';
import type { CapabilityStatus, CapabilityType, Prisma } from '@prisma/client';
import { HarnessError } from '@nova-cbb/harness-shared';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CatalogQueryDto } from './catalog-query.dto.js';

/** Catalog 查询服务：负责分页过滤并把 Prisma 行还原成公共 Capability 契约。 */
@Injectable()
/** Catalog 查询服务，负责分页过滤并把 Prisma 行还原成公共 Capability 契约。 */
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: CatalogQueryDto) {
    const roleIds = query.role ? await this.roleCapabilityIds(query.role) : undefined;
    const where: Prisma.CapabilityWhereInput = {
      deletedAt: null,
      ...(roleIds ? { id: { in: roleIds } } : {}),
      ...(query.tag ? { tags: { array_contains: query.tag } } : {}),
      ...(query.type ? { type: query.type.replace('-', '_').toUpperCase() as CapabilityType } : {}),
      ...(query.status
        ? { status: query.status.replace('-', '_').toUpperCase() as CapabilityStatus }
        : {}),
      ...(query.q
        ? {
            OR: [
              { id: { contains: query.q, mode: 'insensitive' } },
              { name: { contains: query.q, mode: 'insensitive' } },
              { displayName: { contains: query.q, mode: 'insensitive' } },
              { description: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.capability.count({ where }),
      this.prisma.capability.findMany({
        where,
        include: {
          versions: {
            where: { deletedAt: null },
            orderBy: [{ recommended: 'desc' }, { version: 'desc' }],
          },
        },
        orderBy: [{ status: 'asc' }, { displayName: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const mapped = data
      .map(toApiCapability)
      .filter((capability) => (query.runtime ? supportsRuntime(capability, query.runtime) : true));
    return {
      data: mapped,
      total: query.runtime ? mapped.length : total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** 从角色最新发布文档提取直接声明的能力 ID，供 Catalog 组合筛选。 */
  private async roleCapabilityIds(id: string): Promise<string[]> {
    const role = await this.prisma.role.findFirst({
      where: { id, deletedAt: null },
      include: {
        versions: { where: { published: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    const document = role?.versions[0]?.document;
    if (!isRecord(document) || !isRecord(document.capabilities)) return [];
    const capabilities = document.capabilities;
    return ['required', 'recommended', 'optional'].flatMap((level) => {
      const entries = capabilities[level];
      return Array.isArray(entries)
        ? entries.flatMap((item) =>
            isRecord(item) && typeof item.id === 'string' ? [item.id] : [],
          )
        : [];
    });
  }

  async get(id: string) {
    const capability = await this.prisma.capability.findFirst({
      where: { id, deletedAt: null },
      include: { versions: { where: { deletedAt: null }, orderBy: { version: 'desc' } } },
    });
    if (!capability) {
      throw new HarnessError({ code: 'NOT_FOUND', message: `Capability ${id} was not found` });
    }
    return toApiCapability(capability);
  }

  async versions(id: string) {
    await this.get(id);
    return this.prisma.capabilityVersion.findMany({
      where: { capabilityId: id, deletedAt: null },
      orderBy: [{ recommended: 'desc' }, { version: 'desc' }],
    });
  }

  async dependencies(id: string) {
    const capability = (await this.get(id)) as { versions?: Array<{ metadata?: unknown }> };
    return (
      capability.versions?.map((version) => ({
        ...(isRecord(version.metadata) ? version.metadata : {}),
        dependencies:
          isRecord(version.metadata) && Array.isArray(version.metadata.dependencies)
            ? version.metadata.dependencies
            : [],
      })) ?? []
    );
  }

  async compatibility(id: string) {
    const capability = (await this.get(id)) as {
      versions?: Array<{ version: string; metadata?: unknown }>;
    };
    return (
      capability.versions?.map((version) => ({
        version: version.version,
        runtimeBindings:
          isRecord(version.metadata) && isRecord(version.metadata.runtimeBindings)
            ? version.metadata.runtimeBindings
            : {},
      })) ?? []
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 把来源事实 + Admin 覆盖层的 effectiveData 与独立版本治理表重新组合为公共契约。
 * 不直接暴露 Prisma 行，避免 CLI 收到缺少 `source/secrets/configuration` 的半成品对象。
 */
function toApiCapability(capability: {
  type: string;
  status: string;
  riskLevel: string;
  effectiveData?: unknown;
  versions?: unknown;
  sourceId?: unknown;
  sourceLocator?: unknown;
  [key: string]: unknown;
}) {
  const effective = isRecord(capability.effectiveData) ? capability.effectiveData : {};
  const versions = Array.isArray(capability.versions)
    ? capability.versions.flatMap((row) => {
        if (!isRecord(row)) return [];
        const metadata = isRecord(row.metadata) ? row.metadata : {};
        return [
          {
            ...metadata,
            version: row.version,
            recommended: row.recommended,
            ...(typeof row.commitSha === 'string' ? { commitSha: row.commitSha } : {}),
            ...(typeof row.integrity === 'string' ? { integrity: row.integrity } : {}),
            ...(typeof row.archiveSha256 === 'string' ? { archiveSha256: row.archiveSha256 } : {}),
            manifestChecksum: row.manifestChecksum,
          },
        ];
      })
    : [];
  return {
    ...effective,
    versions,
    sourceId: capability.sourceId,
    sourceLocator: capability.sourceLocator,
    type: capability.type.toLowerCase(),
    status: capability.status.toLowerCase().replace('_', '-'),
    riskLevel: capability.riskLevel.toLowerCase(),
  };
}

/** 判断任一可用版本是否声明目标 Runtime binding。 */
function supportsRuntime(capability: Record<string, unknown>, runtime: string): boolean {
  if (!Array.isArray(capability.versions)) return false;
  return capability.versions.some((version) => {
    if (!isRecord(version) || !isRecord(version.metadata)) return false;
    return (
      isRecord(version.metadata.runtimeBindings) && runtime in version.metadata.runtimeBindings
    );
  });
}
