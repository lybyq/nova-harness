import { Injectable } from '@nestjs/common';
import {
  capabilitySchema,
  roleProfileSchema,
  type Capability,
  type RoleProfile,
} from '@nova-cbb/harness-contracts';
import { flattenRole, resolveCapabilities } from '@nova-cbb/harness-core';
import { checksumOf, HarnessError } from '@nova-cbb/harness-shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

/** 角色草稿、不可变版本、联合校验与发布服务；历史 RoleVersion 不物理覆盖。 */
@Injectable()
/** 角色草稿、版本、联合校验与发布服务；历史 RoleVersion 永不物理覆盖。 */
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.role.findMany({
      where: { deletedAt: null },
      include: { versions: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { displayName: 'asc' },
    });
  }

  /** 读取角色；解析安装时可要求只接受已发布版本，管理端编辑则读取最新版本。 */
  async get(id: string, publishedOnly = false): Promise<RoleProfile> {
    const role = await this.prisma.role.findFirst({
      where: { id, deletedAt: null },
      include: {
        versions: {
          ...(publishedOnly ? { where: { published: true } } : {}),
          orderBy: [{ published: 'desc' }, { createdAt: 'desc' }],
          take: 1,
        },
      },
    });
    if (!role?.versions[0])
      throw new HarnessError({
        code: 'NOT_FOUND',
        message: `${publishedOnly ? 'Published role' : 'Role'} ${id} was not found`,
      });
    return roleProfileSchema.parse(role.versions[0].document);
  }

  async save(value: unknown): Promise<RoleProfile> {
    const document = roleProfileSchema.parse(value);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.role.upsert({
        where: { id: document.metadata.id },
        create: {
          id: document.metadata.id,
          displayName: document.metadata.displayName,
          description: document.metadata.description,
        },
        update: {
          displayName: document.metadata.displayName,
          description: document.metadata.description,
          deletedAt: null,
          rowVersion: { increment: 1 },
        },
      });
      await transaction.roleVersion.upsert({
        where: {
          roleId_version: { roleId: document.metadata.id, version: document.metadata.version },
        },
        create: {
          roleId: document.metadata.id,
          version: document.metadata.version,
          document: toJson(document),
          checksum: checksumOf(document),
        },
        update: { document: toJson(document), checksum: checksumOf(document) },
      });
    });
    return document;
  }

  /**
   * 联合校验角色契约、继承图、依赖版本和冲突声明。
   * 校验不会保存草稿；可预期的领域冲突以结构化结果返回，便于 Admin 就地展示。
   */
  async validate(value: unknown): Promise<{
    valid: boolean;
    missingCapabilities: string[];
    conflicts: Array<{ code: string; message: string; details?: unknown }>;
    installationOrder: string[];
    warnings: string[];
  }> {
    const document = roleProfileSchema.parse(value);
    const [roleRows, capabilityRows] = await Promise.all([
      this.prisma.role.findMany({
        where: { deletedAt: null },
        include: { versions: { orderBy: [{ published: 'desc' }, { createdAt: 'desc' }], take: 1 } },
      }),
      this.prisma.capability.findMany({ where: { deletedAt: null } }),
    ]);
    const roles = new Map<string, RoleProfile>([[document.metadata.id, document]]);
    for (const row of roleRows) {
      const parsed = roleProfileSchema.safeParse(row.versions[0]?.document);
      if (parsed.success && !roles.has(parsed.data.metadata.id))
        roles.set(parsed.data.metadata.id, parsed.data);
    }
    const catalog = new Map<string, Capability>();
    for (const row of capabilityRows) {
      const parsed = capabilitySchema.safeParse(row.effectiveData);
      if (parsed.success) catalog.set(parsed.data.id, parsed.data);
    }
    const directIds = [
      ...document.capabilities.required,
      ...document.capabilities.recommended,
      ...document.capabilities.optional,
    ].map((item) => item.id);
    const missingCapabilities = directIds.filter((id) => !catalog.has(id));
    try {
      const role = flattenRole(document, { get: (id) => roles.get(id) });
      const result = resolveCapabilities(role, { get: (id) => catalog.get(id) });
      return {
        valid: missingCapabilities.length === 0,
        missingCapabilities,
        conflicts: [],
        installationOrder: result.installationOrder,
        warnings: result.warnings,
      };
    } catch (error) {
      if (error instanceof HarnessError)
        return {
          valid: false,
          missingCapabilities,
          conflicts: [{ code: error.code, message: error.message, details: error.details }],
          installationOrder: [],
          warnings: [],
        };
      throw error;
    }
  }

  async publish(id: string): Promise<RoleProfile> {
    const role = await this.prisma.role.findFirst({
      where: { id, deletedAt: null },
      include: { versions: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    const latest = role?.versions[0];
    if (!role || !latest)
      throw new HarnessError({ code: 'NOT_FOUND', message: `Role ${id} was not found` });
    await this.prisma.$transaction([
      this.prisma.roleVersion.updateMany({ where: { roleId: id }, data: { published: false } }),
      this.prisma.roleVersion.update({ where: { id: latest.id }, data: { published: true } }),
      this.prisma.role.update({
        where: { id },
        data: { published: true, rowVersion: { increment: 1 } },
      }),
    ]);
    return roleProfileSchema.parse(latest.document);
  }
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
