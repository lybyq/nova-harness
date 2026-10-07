import type {
  CapabilityRequirement,
  PermissionRule,
  ProfileOverrides,
  RoleProfile,
} from '@nova-cbb/harness-contracts';
import { HarnessError } from '@nova-cbb/harness-shared';

/** 角色继承解析使用的只读注册表。 */
export interface RoleRegistry {
  get(id: string): RoleProfile | undefined;
}

/** 完成继承和权限收紧后的扁平角色，供依赖解析器消费。 */
export interface FlattenedRole {
  id: string;
  version: string;
  runtimeId: string;
  defaultAgent?: string;
  required: CapabilityRequirement[];
  recommended: CapabilityRequirement[];
  optional: CapabilityRequirement[];
  denied: string[];
  permissions: PermissionRule[];
  defaults: Record<string, unknown>;
}

/**
 * 深度优先展开角色继承，检测继承环并应用 deny/enforced 规则。
 * @throws {HarnessError} 父角色缺失或继承成环时拒绝生成不完整角色。
 */
export function flattenRole(role: RoleProfile, registry: RoleRegistry): FlattenedRole {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: RoleProfile[] = [];

  const visit = (candidate: RoleProfile): void => {
    if (visiting.has(candidate.metadata.id)) {
      throw new HarnessError({
        code: 'CONFIG_INVALID',
        message: `Role inheritance cycle detected at ${candidate.metadata.id}`,
      });
    }
    if (visited.has(candidate.metadata.id)) return;
    visiting.add(candidate.metadata.id);
    for (const parentId of candidate.extends) {
      const parent = registry.get(parentId);
      if (!parent) {
        throw new HarnessError({
          code: 'NOT_FOUND',
          message: `Parent role ${parentId} was not found`,
          details: { roleId: candidate.metadata.id, parentId },
        });
      }
      visit(parent);
    }
    visiting.delete(candidate.metadata.id);
    visited.add(candidate.metadata.id);
    ordered.push(candidate);
  };

  visit(role);

  const required = new Map<string, CapabilityRequirement>();
  const recommended = new Map<string, CapabilityRequirement>();
  const optional = new Map<string, CapabilityRequirement>();
  const denied = new Set<string>();
  const permissions = new Map<string, PermissionRule>();
  let defaults: Record<string, unknown> = {};

  for (const layer of ordered) {
    mergeRequirements(required, layer.capabilities.required);
    mergeRequirements(recommended, layer.capabilities.recommended);
    mergeRequirements(optional, layer.capabilities.optional);
    for (const id of layer.capabilities.denied) denied.add(id);
    for (const permission of layer.permissions) {
      const existing = permissions.get(permission.id);
      permissions.set(permission.id, mergePermission(existing, permission));
    }
    defaults = deepMerge(defaults, layer.defaults);
  }

  for (const id of denied) {
    required.delete(id);
    recommended.delete(id);
    optional.delete(id);
  }

  const result: FlattenedRole = {
    id: role.metadata.id,
    version: role.metadata.version,
    runtimeId: role.runtime.default,
    required: [...required.values()],
    recommended: [...recommended.values()],
    optional: [...optional.values()],
    denied: [...denied],
    permissions: [...permissions.values()],
    defaults,
  };
  if (role.runtime.defaultAgent !== undefined) result.defaultAgent = role.runtime.defaultAgent;
  return result;
}

/** 按 Organization→Role→Project→User→Session 顺序应用覆盖，required 与 deny 不可被弱化。 */
export function applyOverrides(role: FlattenedRole, layers: ProfileOverrides[]): FlattenedRole {
  const required = new Map(role.required.map((item) => [item.id, item]));
  const recommended = new Map(role.recommended.map((item) => [item.id, item]));
  const optional = new Map(role.optional.map((item) => [item.id, item]));
  const denied = new Set(role.denied);
  const permissions = new Map(role.permissions.map((item) => [item.id, item]));

  for (const layer of layers) {
    for (const id of layer.remove) {
      if (!required.has(id)) {
        recommended.delete(id);
        optional.delete(id);
      }
    }
    for (const addition of layer.add) {
      if (!denied.has(addition.id)) recommended.set(addition.id, addition);
    }
    for (const [id, configuration] of Object.entries(layer.configuration)) {
      for (const bucket of [required, recommended, optional]) {
        const current = bucket.get(id);
        if (current)
          bucket.set(id, {
            ...current,
            configuration: deepMerge(current.configuration, configuration),
          });
      }
    }
    for (const permission of layer.permissions) {
      const existing = permissions.get(permission.id);
      permissions.set(permission.id, mergePermission(existing, permission));
    }
  }

  return {
    ...role,
    required: [...required.values()],
    recommended: [...recommended.values()],
    optional: [...optional.values()],
    denied: [...denied],
    permissions: [...permissions.values()],
  };
}

function mergeRequirements(
  target: Map<string, CapabilityRequirement>,
  incoming: CapabilityRequirement[],
): void {
  for (const requirement of incoming) {
    const current = target.get(requirement.id);
    target.set(requirement.id, {
      ...current,
      ...requirement,
      configuration: deepMerge(current?.configuration ?? {}, requirement.configuration),
    });
  }
}

function mergePermission(
  current: PermissionRule | undefined,
  incoming: PermissionRule,
): PermissionRule {
  if (!current) return incoming;
  const severity = { allow: 0, requireApproval: 1, deny: 2 } as const;
  if (current.enforced && severity[incoming.effect] < severity[current.effect]) return current;
  return severity[incoming.effect] >= severity[current.effect] ? incoming : current;
}

function deepMerge(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const output = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const current = output[key];
    output[key] =
      isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value;
  }
  return output;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
