import { Injectable } from '@nestjs/common';
import {
  capabilitySchema,
  profileOverridesSchema,
  type Capability,
  type RoleProfile,
} from '@nova-cbb/harness-contracts';
import { applyOverrides, flattenRole, resolveCapabilities } from '@nova-cbb/harness-core';
import { checksumOf } from '@nova-cbb/harness-shared';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service.js';
import { RolesService } from '../roles/roles.service.js';

const requestSchema = z.object({
  runtime: z.string().default('claude-code'),
  role: z.string().min(1),
  scope: z.enum(['user', 'project', 'local']).default('user'),
  add: z.array(z.string()).default([]),
  remove: z.array(z.string()).default([]),
  disable: z.array(z.string()).default([]),
  includeOptional: z.array(z.string()).default([]),
  configuration: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  permissions: z.array(z.unknown()).default([]),
});

/** 把已发布角色、分层覆盖和 Catalog 快照解析为精确、可解释的 Desired State。 */
@Injectable()
/** 把已发布 Role、Profile overrides 与 Catalog 快照解析为精确 Desired State。 */
export class ResolveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roles: RolesService,
  ) {}
  async resolve(input: unknown) {
    const request = requestSchema.parse(input);
    const roleMap = new Map<string, RoleProfile>();
    const load = async (id: string): Promise<void> => {
      if (roleMap.has(id)) return;
      const role = await this.roles.get(id, true);
      roleMap.set(id, role);
      await Promise.all(role.extends.map(load));
    };
    await load(request.role);
    const role = roleMap.get(request.role)!;
    const flattened = applyOverrides(flattenRole(role, { get: (id) => roleMap.get(id) }), [
      profileOverridesSchema.parse({
        add: request.add.map((id) => ({ id })),
        remove: request.remove,
        disable: request.disable,
        configuration: request.configuration,
        permissions: request.permissions,
      }),
    ]);
    const rows = await this.prisma.capability.findMany({ where: { deletedAt: null } });
    const catalog = new Map<string, Capability>();
    for (const row of rows) {
      const parsed = capabilitySchema.safeParse(row.effectiveData);
      if (parsed.success) catalog.set(parsed.data.id, parsed.data);
    }
    const result = resolveCapabilities(
      flattened,
      { get: (id) => catalog.get(id) },
      { includeOptional: request.includeOptional, disabled: request.disable },
    );
    const requiredSecrets = [
      ...new Set(
        result.capabilities.flatMap(
          (item) =>
            catalog
              .get(item.id)
              ?.secrets.filter((secret) => secret.required)
              .map((secret) => secret.key) ?? [],
        ),
      ),
    ];
    const requiredConfiguration = [
      ...new Set(
        result.capabilities.flatMap(
          (item) =>
            catalog
              .get(item.id)
              ?.configuration.filter((entry) => entry.required)
              .map((entry) => entry.key) ?? [],
        ),
      ),
    ];
    const payload = {
      role,
      permissions: flattened.permissions,
      capabilities: result.capabilities,
      installationOrder: result.installationOrder,
      versions: Object.fromEntries(result.capabilities.map((item) => [item.id, item.version])),
      requiredSecrets,
      requiredConfiguration,
      conflicts: [],
      warnings: result.warnings,
      compatibility: Object.fromEntries(
        result.capabilities.map((item) => [
          item.id,
          Boolean(
            catalog.get(item.id)?.versions.find((version) => version.version === item.version)
              ?.runtimeBindings[request.runtime],
          ),
        ]),
      ),
    };
    return { ...payload, checksum: checksumOf(payload) };
  }
}
