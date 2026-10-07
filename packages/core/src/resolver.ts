import type {
  Capability,
  CapabilityRequirement,
  CapabilityVersion,
  ResolvedCapability,
} from '@nova-cbb/harness-contracts';
import { HarnessError } from '@nova-cbb/harness-shared';
import semver from 'semver';
import type { FlattenedRole } from './profile-merge.js';

/** 依赖解析使用的 Catalog 快照接口。 */
export interface ResolveCatalog {
  get(id: string): Capability | undefined;
}

/** 可选能力与会话禁用项。 */
export interface ResolveOptions {
  includeOptional?: string[];
  disabled?: string[];
}

/** 解析后的精确版本、拓扑安装顺序和非致命警告。 */
export interface ResolveResult {
  capabilities: ResolvedCapability[];
  installationOrder: string[];
  warnings: string[];
}

interface PendingRequirement extends CapabilityRequirement {
  reasonPath: string[];
}

/**
 * 递归解析依赖、SemVer 和 conflicts，生成单版本拓扑序。
 * @throws {HarnessError} 缺失、版本无解、冲突或依赖环均作为确定性领域错误返回。
 */
export function resolveCapabilities(
  role: FlattenedRole,
  catalog: ResolveCatalog,
  options: ResolveOptions = {},
): ResolveResult {
  const disabled = new Set(options.disabled ?? []);
  const denied = new Set(role.denied);
  const pending: PendingRequirement[] = [
    ...role.required.map((item) => ({ ...item, reasonPath: [`role:${role.id}:required`] })),
    ...role.recommended.map((item) => ({ ...item, reasonPath: [`role:${role.id}:recommended`] })),
  ];

  for (const id of options.includeOptional ?? []) {
    const requirement = role.optional.find((item) => item.id === id);
    if (!requirement) {
      throw new HarnessError({
        code: 'CONFIG_INVALID',
        message: `${id} is not an optional capability of role ${role.id}`,
      });
    }
    pending.push({ ...requirement, reasonPath: [`role:${role.id}:optional`] });
  }

  const selected = new Map<string, { version: CapabilityVersion; reasons: Set<string> }>();
  const edges = new Map<string, Set<string>>();
  const warnings: string[] = [];

  while (pending.length > 0) {
    const requirement = pending.shift();
    if (!requirement) break;
    if (denied.has(requirement.id)) {
      throw new HarnessError({
        code: 'PLAN_CONFLICT',
        message: `${requirement.id} is required and denied at the same time`,
        details: { reasonPath: requirement.reasonPath },
      });
    }

    const capability = catalog.get(requirement.id);
    if (!capability || capability.status === 'disabled') {
      throw new HarnessError({
        code: 'NOT_FOUND',
        message: `Capability ${requirement.id} is not available`,
        details: { reasonPath: requirement.reasonPath },
      });
    }

    const version = chooseVersion(capability, requirement.range);
    const current = selected.get(requirement.id);
    if (current && current.version.version !== version.version) {
      throw new HarnessError({
        code: 'PLAN_CONFLICT',
        message: `No single version of ${requirement.id} satisfies all requirements`,
        details: {
          selected: current.version.version,
          requested: requirement.range,
          reasonPath: requirement.reasonPath,
        },
      });
    }

    // 同一版本可能经多条依赖路径再次到达；只聚合来源理由，避免循环依赖在拓扑检测前无限展开队列。
    if (current) {
      for (const reason of requirement.reasonPath) current.reasons.add(reason);
      continue;
    }

    const item = { version, reasons: new Set<string>() };
    for (const reason of requirement.reasonPath) item.reasons.add(reason);
    selected.set(requirement.id, item);
    const dependencyIds = edges.get(requirement.id) ?? new Set<string>();

    for (const conflict of version.conflicts) {
      const conflicting = selected.get(conflict.id);
      if (conflicting && satisfies(conflicting.version.version, conflict.range)) {
        throw new HarnessError({
          code: 'PLAN_CONFLICT',
          message: `${requirement.id} conflicts with ${conflict.id}`,
          details: { reason: conflict.reason },
        });
      }
    }

    for (const dependency of version.dependencies) {
      if (dependency.optional) {
        warnings.push(
          `Optional dependency ${dependency.id} of ${requirement.id} was not automatically installed`,
        );
        continue;
      }
      dependencyIds.add(dependency.id);
      pending.push({
        id: dependency.id,
        range: dependency.range,
        reason: dependency.reason,
        configuration: {},
        reasonPath: [...requirement.reasonPath, `dependency:${requirement.id}`],
      });
    }
    edges.set(requirement.id, dependencyIds);
  }

  for (const [id, item] of selected) {
    const capability = catalog.get(id)!;
    for (const conflict of item.version.conflicts) {
      const conflicting = selected.get(conflict.id);
      if (conflicting && satisfies(conflicting.version.version, conflict.range)) {
        throw new HarnessError({
          code: 'PLAN_CONFLICT',
          message: `${id} conflicts with ${conflict.id}`,
          details: { reason: conflict.reason },
        });
      }
    }
    if (capability.status === 'deprecated') warnings.push(`${id} is deprecated`);
    if (capability.status === 'needs-review') warnings.push(`${id} needs metadata review`);
  }

  const installationOrder = topologicalOrder(selected.keys(), edges);
  const capabilities = installationOrder.map((id) => {
    const item = selected.get(id)!;
    return {
      id,
      version: item.version.version,
      reason: [...item.reasons],
      enabled: !disabled.has(id),
      configuration: {},
    } satisfies ResolvedCapability;
  });

  return { capabilities, installationOrder, warnings: [...new Set(warnings)] };
}

function chooseVersion(capability: Capability, range: string): CapabilityVersion {
  const compatible = capability.versions.filter((version) => satisfies(version.version, range));
  const recommended = compatible.find((version) => version.recommended);
  if (recommended) return recommended;
  const sorted = [...compatible].sort((left, right) =>
    compareVersions(right.version, left.version),
  );
  const selected = sorted[0];
  if (!selected) {
    throw new HarnessError({
      code: 'COMPATIBILITY_ERROR',
      message: `No version of ${capability.id} satisfies ${range}`,
    });
  }
  return selected;
}

function satisfies(version: string, range: string): boolean {
  const valid = semver.valid(version);
  if (valid) return semver.satisfies(valid, range, { includePrerelease: true });
  return range === '*' || range === version;
}

function compareVersions(left: string, right: string): number {
  const leftValid = semver.valid(left);
  const rightValid = semver.valid(right);
  if (leftValid && rightValid) return semver.compare(leftValid, rightValid);
  return left.localeCompare(right);
}

function topologicalOrder(ids: Iterable<string>, edges: Map<string, Set<string>>): string[] {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const output: string[] = [];

  const visit = (id: string): void => {
    if (visiting.has(id)) {
      throw new HarnessError({
        code: 'PLAN_CONFLICT',
        message: `Dependency cycle detected at ${id}`,
      });
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of edges.get(id) ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
    output.push(id);
  };

  for (const id of ids) visit(id);
  return output;
}
