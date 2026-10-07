import { z } from 'zod';
import { identifierSchema, semverRangeSchema } from './common.js';

/** 校验角色或覆盖层提出的能力版本要求及原因。 */
export const capabilityRequirementSchema = z.object({
  id: identifierSchema,
  range: semverRangeSchema.default('*'),
  reason: z.string().max(500).default(''),
  configuration: z.record(z.string(), z.unknown()).default({}),
});

/** 校验权限合并支持的三种效果；deny 在合并时拥有最高优先级。 */
export const permissionEffectSchema = z.enum(['allow', 'deny', 'requireApproval']);

/** 校验可审计的权限规则以及不可被低层覆盖的强制标记。 */
export const permissionRuleSchema = z.object({
  id: identifierSchema,
  effect: permissionEffectSchema,
  action: z.string().min(1),
  resource: z.string().min(1).default('*'),
  conditions: z.record(z.string(), z.unknown()).default({}),
  enforced: z.boolean().default(false),
});

/** 校验可继承的角色能力、Runtime、权限和默认配置文档。 */
export const roleProfileSchema = z.object({
  apiVersion: z.literal('harness.nova/v1'),
  kind: z.literal('RoleProfile'),
  metadata: z.object({
    id: identifierSchema,
    displayName: z.string().min(1).max(128),
    description: z.string().max(2_000).default(''),
    version: z.string().min(1),
  }),
  extends: z.array(identifierSchema).default([]),
  runtime: z.object({
    default: identifierSchema,
    defaultAgent: identifierSchema.optional(),
  }),
  capabilities: z.object({
    required: z.array(capabilityRequirementSchema).default([]),
    recommended: z.array(capabilityRequirementSchema).default([]),
    optional: z.array(capabilityRequirementSchema).default([]),
    denied: z.array(identifierSchema).default([]),
  }),
  permissions: z.array(permissionRuleSchema).default([]),
  defaults: z.record(z.string(), z.unknown()).default({}),
});

/** 校验 Project/User/Session 层的增删、禁用、配置和权限覆盖。 */
export const profileOverridesSchema = z.object({
  add: z.array(capabilityRequirementSchema).default([]),
  remove: z.array(identifierSchema).default([]),
  disable: z.array(identifierSchema).default([]),
  configuration: z.record(identifierSchema, z.record(z.string(), z.unknown())).default({}),
  permissions: z.array(permissionRuleSchema).default([]),
});

/** 带来源原因的能力要求类型。 */
export type CapabilityRequirement = z.infer<typeof capabilityRequirementSchema>;
/** 可合并、可审计的权限规则类型。 */
export type PermissionRule = z.infer<typeof permissionRuleSchema>;
/** 角色 Profile 文档类型。 */
export type RoleProfile = z.infer<typeof roleProfileSchema>;
/** Profile 分层覆盖文档类型。 */
export type ProfileOverrides = z.infer<typeof profileOverridesSchema>;
