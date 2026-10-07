import type {
  ActualState,
  DesiredState,
  ExecutionPlan,
  PlanOperation,
} from '@nova-cbb/harness-contracts';
import { checksumOf } from '@nova-cbb/harness-shared';

/** 生成 Plan 时绑定的 Catalog 快照信息，防止 Apply 使用漂移后的元数据。 */
export interface PlanContext {
  catalogChecksum: string;
  requiredSecrets?: string[];
  warnings?: string[];
  breakingChanges?: string[];
  now?: Date;
  id?: string;
}

/**
 * 比较 Desired/Actual 并生成稳定有序的执行计划。
 * @returns 包含安装、更新、启停、删除及最终 Runtime 编译操作的不可变 Plan。
 */
export function createExecutionPlan(
  desired: DesiredState,
  actual: ActualState,
  context: PlanContext,
): ExecutionPlan {
  assertSameIdentity(desired, actual);
  const installed = new Map(actual.installed.map((item) => [item.id, item]));
  const wanted = new Map(desired.capabilities.map((item) => [item.id, item]));
  const operations: PlanOperation[] = [];
  let sequence = 0;
  const nextId = (): string => `op-${String(++sequence).padStart(4, '0')}`;

  for (const capability of desired.capabilities) {
    const existing = installed.get(capability.id);
    if (!existing) {
      operations.push({
        id: nextId(),
        type: 'install-capability',
        target: capability.id,
        capabilityId: capability.id,
        toVersion: capability.version,
        destructive: false,
        details: { reason: capability.reason },
      });
    } else if (existing.version !== capability.version) {
      operations.push({
        id: nextId(),
        type: 'update-capability',
        target: capability.id,
        capabilityId: capability.id,
        fromVersion: existing.version,
        toVersion: capability.version,
        destructive: false,
        details: {},
      });
    }

    if (existing && existing.enabled !== capability.enabled) {
      operations.push({
        id: nextId(),
        type: capability.enabled ? 'enable-capability' : 'disable-capability',
        target: capability.id,
        capabilityId: capability.id,
        destructive: false,
        details: {},
      });
    }
  }

  for (const capability of actual.installed) {
    if (!wanted.has(capability.id)) {
      operations.push({
        id: nextId(),
        type: 'remove-capability',
        target: capability.id,
        capabilityId: capability.id,
        fromVersion: capability.version,
        destructive: true,
        details: {},
      });
    }
  }

  if (operations.length > 0 || actual.appliedDesiredChecksum !== desired.checksum) {
    operations.push({
      id: nextId(),
      type: 'write-runtime-config',
      target: desired.identity.runtimeId,
      destructive: false,
      details: { desiredChecksum: desired.checksum },
    });
  }

  const createdAt = (context.now ?? new Date()).toISOString();
  return {
    id: context.id ?? `plan-${checksumOf({ createdAt, desired: desired.checksum }).slice(0, 12)}`,
    identity: desired.identity,
    createdAt,
    desiredChecksum: desired.checksum,
    actualChecksum: checksumOf(actual),
    catalogChecksum: context.catalogChecksum,
    operations,
    warnings: context.warnings ?? [],
    requiredSecrets: context.requiredSecrets ?? [],
    breakingChanges: context.breakingChanges ?? [],
  };
}

function assertSameIdentity(desired: DesiredState, actual: ActualState): void {
  if (checksumOf(desired.identity) !== checksumOf(actual.identity)) {
    throw new Error('Desired and actual state identities do not match');
  }
}
