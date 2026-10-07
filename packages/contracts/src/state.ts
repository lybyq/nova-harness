import { z } from 'zod';
import { identifierSchema } from './common.js';
import { permissionRuleSchema, profileOverridesSchema } from './profile.js';

/** 校验状态隔离范围；`local` 主要用于临时验证与 E2E。 */
export const scopeSchema = z.enum(['user', 'project', 'local']);

/** 校验 Deployment、Runtime、Scope 和项目共同组成的状态分区键。 */
export const stateIdentitySchema = z.object({
  deploymentId: identifierSchema,
  runtimeId: identifierSchema,
  scope: scopeSchema,
  projectId: z.string().min(1).optional(),
});

/** 校验依赖解析完成后写入 Desired State 的精确能力版本。 */
export const resolvedCapabilitySchema = z.object({
  id: identifierSchema,
  version: z.string().min(1),
  reason: z.array(z.string().min(1)).min(1),
  enabled: z.boolean().default(true),
  configuration: z.record(z.string(), z.unknown()).default({}),
});

/** 校验用户意图的规范化快照；checksum 用于阻止过期 Plan 被 Apply。 */
export const desiredStateSchema = z.object({
  identity: stateIdentitySchema,
  roleId: identifierSchema,
  roleVersion: z.string().min(1),
  capabilities: z.array(resolvedCapabilitySchema),
  permissions: z.array(permissionRuleSchema),
  overrides: profileOverridesSchema,
  checksum: z.string().regex(/^[a-f0-9]{64}$/i),
});

/** 校验本地不可变 Store 中已安装能力的观测记录。 */
export const installedCapabilitySchema = z.object({
  id: identifierSchema,
  version: z.string().min(1),
  enabled: z.boolean(),
  sourceId: identifierSchema,
  integrity: z.string().optional(),
  installedAt: z.string().datetime(),
  storePath: z.string().min(1),
});

/** 校验 Runtime 检查后得到的实际状态、所有权文件和应用校验和。 */
export const actualStateSchema = z.object({
  identity: stateIdentitySchema,
  installed: z.array(installedCapabilitySchema),
  runtimeConfigurationChecksum: z.string().optional(),
  appliedDesiredChecksum: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
  managedFiles: z.array(
    z.object({
      path: z.string().min(1),
      checksum: z.string().regex(/^[a-f0-9]{64}$/i),
    }),
  ),
  observedAt: z.string().datetime(),
});

/** 校验 Plan/Apply 引擎允许执行的封闭操作集合。 */
export const planOperationTypeSchema = z.enum([
  'install-capability',
  'remove-capability',
  'enable-capability',
  'disable-capability',
  'update-capability',
  'write-runtime-config',
  'patch-runtime-config',
  'copy-file',
  'remove-managed-file',
  'set-secret-reference',
  'register-marketplace',
  'install-plugin',
  'remove-plugin',
]);

/** 校验单项可预览、可审计的执行操作。 */
export const planOperationSchema = z.object({
  id: identifierSchema,
  type: planOperationTypeSchema,
  target: z.string().min(1),
  capabilityId: identifierSchema.optional(),
  fromVersion: z.string().optional(),
  toVersion: z.string().optional(),
  destructive: z.boolean().default(false),
  details: z.record(z.string(), z.unknown()).default({}),
});

/**
 * 校验完整执行计划。
 * Desired、Actual 和 Catalog 三个校验和共同保证确认后的计划不会漂移。
 */
export const executionPlanSchema = z.object({
  id: identifierSchema,
  identity: stateIdentitySchema,
  createdAt: z.string().datetime(),
  desiredChecksum: z.string().regex(/^[a-f0-9]{64}$/i),
  actualChecksum: z.string().regex(/^[a-f0-9]{64}$/i),
  catalogChecksum: z.string().regex(/^[a-f0-9]{64}$/i),
  operations: z.array(planOperationSchema),
  warnings: z.array(z.string()),
  requiredSecrets: z.array(z.string()),
  breakingChanges: z.array(z.string()),
});

/** 本地状态分区标识类型。 */
export type StateIdentity = z.infer<typeof stateIdentitySchema>;
/** 已锁定版本并带解释链的能力类型。 */
export type ResolvedCapability = z.infer<typeof resolvedCapabilitySchema>;
/** 用户期望状态类型。 */
export type DesiredState = z.infer<typeof desiredStateSchema>;
/** 本地 Store 安装记录类型。 */
export type InstalledCapability = z.infer<typeof installedCapabilitySchema>;
/** Runtime 和 Store 的实际状态类型。 */
export type ActualState = z.infer<typeof actualStateSchema>;
/** 单项执行操作类型。 */
export type PlanOperation = z.infer<typeof planOperationSchema>;
/** 带防漂移校验和的执行计划类型。 */
export type ExecutionPlan = z.infer<typeof executionPlanSchema>;
