import { z } from 'zod';
import { identifierSchema, secretReferenceSchema, semverRangeSchema } from './common.js';

/** 校验能力的统一类别；新增 Runtime 时不得在 Core 中另建私有类别。 */
export const capabilityTypeSchema = z.enum([
  'mcp',
  'skill',
  'plugin',
  'agent',
  'hook',
  'policy',
  'pack',
]);

/** 校验安装审批所使用的风险等级。 */
export const riskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);
/** 校验能力在目录中的审核与生命周期状态。 */
export const reviewStatusSchema = z.enum([
  'active',
  'deprecated',
  'disabled',
  'experimental',
  'needs-review',
]);

/** 校验可展示的维护人元数据；不接受凭证或其他敏感字段。 */
export const maintainerSchema = z.object({
  name: z.string().min(1).optional(),
  team: z.string().min(1).optional(),
  email: z.string().email().optional(),
});

/** 校验一个带 SemVer 范围、可选性和可解释原因的能力依赖。 */
export const capabilityDependencySchema = z.object({
  id: identifierSchema,
  range: semverRangeSchema.default('*'),
  optional: z.boolean().default(false),
  reason: z.string().max(500).default(''),
});

/** 校验能力冲突；冲突原因是 Plan 阻止 Apply 时的用户可操作说明。 */
export const capabilityConflictSchema = z.object({
  id: identifierSchema,
  range: semverRangeSchema.default('*'),
  reason: z.string().min(1).max(500),
});

/** 校验 Secret 的引用声明；模型只保存引用键，绝不承载 Secret 明文。 */
export const secretDefinitionSchema = z.object({
  key: secretReferenceSchema,
  required: z.boolean().default(true),
  description: z.string().max(500).default(''),
  scope: z.enum(['deployment', 'user', 'project', 'session']).default('user'),
});

/** 校验能力公开配置项及其约束，供 CLI 收集配置和 Doctor 检查使用。 */
export const configurationDefinitionSchema = z.object({
  key: z.string().min(1),
  required: z.boolean().default(true),
  secret: z.boolean().default(false),
  description: z.string().max(500).default(''),
  schema: z.record(z.string(), z.unknown()).default({}),
});

/** 校验声明式健康检查；`safe` 用于阻止 Doctor 默认执行有副作用的探测。 */
export const healthCheckDefinitionSchema = z.object({
  type: z.string().min(1),
  safe: z.boolean().default(true),
  timeoutMs: z.number().int().positive().max(120_000).default(10_000),
  options: z.record(z.string(), z.unknown()).default({}),
});

/** 校验某版本能力面向特定 Runtime 的编译绑定与兼容范围。 */
export const runtimeBindingSchema = z.object({
  type: z.string().min(1),
  compatibility: semverRangeSchema.default('*'),
  configuration: z.record(z.string(), z.unknown()).default({}),
});

/** 校验不可变能力版本以及下载完整性、依赖和 Runtime 绑定信息。 */
export const capabilityVersionSchema = z.object({
  version: z.string().min(1),
  recommended: z.boolean().default(false),
  commitSha: z
    .string()
    .regex(/^[a-f0-9]{7,64}$/i)
    .optional(),
  integrity: z.string().min(1).optional(),
  archiveSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
  artifact: z
    .object({
      kind: z.enum(['npm-tarball', 'gitlab-archive']),
      url: z.string().url(),
      entryPath: z.string().min(1).optional(),
    })
    .optional(),
  manifestChecksum: z.string().regex(/^[a-f0-9]{64}$/i),
  publishedAt: z.string().datetime().optional(),
  dependencies: z.array(capabilityDependencySchema).default([]),
  conflicts: z.array(capabilityConflictSchema).default([]),
  runtimeBindings: z.record(identifierSchema, runtimeBindingSchema).default({}),
});

/**
 * 校验 Hub 与 CLI 之间的完整能力契约。
 * Source 原始元数据与管理员覆盖分区保存，防止同步覆盖人工治理结果。
 */
export const capabilitySchema = z.object({
  id: identifierSchema,
  type: capabilityTypeSchema,
  name: z.string().min(1).max(256),
  displayName: z.string().min(1).max(256),
  description: z.string().max(10_000).default(''),
  tags: z.array(z.string().min(1)).default([]),
  categories: z.array(z.string().min(1)).default([]),
  maintainers: z.array(maintainerSchema).default([]),
  status: reviewStatusSchema.default('needs-review'),
  riskLevel: riskLevelSchema.default('medium'),
  source: z.object({
    sourceId: identifierSchema,
    kind: z.enum(['gitlab', 'npm', 'local']),
    locator: z.string().min(1),
    projectId: z.number().int().positive().optional(),
    packageName: z.string().min(1).optional(),
  }),
  versions: z.array(capabilityVersionSchema).default([]),
  secrets: z.array(secretDefinitionSchema).default([]),
  configuration: z.array(configurationDefinitionSchema).default([]),
  sourceMetadata: z.record(z.string(), z.unknown()).default({}),
  adminOverrides: z.record(z.string(), z.unknown()).default({}),
});

/** 能力类别的静态类型。 */
export type CapabilityType = z.infer<typeof capabilityTypeSchema>;
/** 安装审批风险等级的静态类型。 */
export type RiskLevel = z.infer<typeof riskLevelSchema>;
/** 能力依赖声明的静态类型。 */
export type CapabilityDependency = z.infer<typeof capabilityDependencySchema>;
/** 能力冲突声明的静态类型。 */
export type CapabilityConflict = z.infer<typeof capabilityConflictSchema>;
/** 不可变能力版本记录的静态类型。 */
export type CapabilityVersion = z.infer<typeof capabilityVersionSchema>;
/** Hub 目录中统一能力文档的静态类型。 */
export type Capability = z.infer<typeof capabilitySchema>;
