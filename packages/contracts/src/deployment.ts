import { z } from 'zod';
import {
  defaultHttpPolicy,
  defaultNetworkPolicy,
  downloadPolicySchema,
  httpPolicySchema,
  identifierSchema,
  networkPolicySchema,
  secretReferenceSchema,
} from './common.js';

const sourceBaseSchema = z.object({
  id: identifierSchema,
  displayName: z.string().min(1).max(128),
  enabled: z.boolean().default(true),
  authRef: secretReferenceSchema.optional(),
  http: httpPolicySchema.default(defaultHttpPolicy),
});

/** 校验可迁移到任意 GitLab 实例的递归能力源配置。 */
export const gitLabSourceSchema = sourceBaseSchema.extend({
  type: z.literal('gitlab'),
  baseUrl: z.string().url(),
  apiPath: z.string().startsWith('/').default('/api/v4'),
  rootGroup: z.string().min(1),
  skillGroupPath: z.string().min(1).default('skills'),
  pluginGroupPath: z.string().min(1).default('plugins'),
  recursive: z.boolean().default(true),
  includeSharedProjects: z.boolean().default(false),
  manifestPath: z.string().min(1).default('nova.manifest.yaml'),
});

/** 校验 npm/Nexus/CNPM/静态索引兼容的 Registry 来源配置。 */
export const npmSourceSchema = sourceBaseSchema.extend({
  type: z.literal('npm'),
  registry: z.string().url(),
  adapter: z.enum(['npm-compatible', 'nexus', 'cnpm', 'static-index', 'auto']),
  scopes: z.array(z.string().startsWith('@')).default([]),
  packagePatterns: z.array(z.string().min(1)).default([]),
  seedPackages: z.array(z.string().min(1)).default([]),
  staticIndexUrl: z.string().url().optional(),
  manifestField: z.string().min(1).default('novaHarness'),
});

/** 根据 `type` 安全区分所有受支持的目录来源。 */
export const catalogSourceSchema = z.discriminatedUnion('type', [
  gitLabSourceSchema,
  npmSourceSchema,
]);

/**
 * 校验一套可移植的部署配置。
 * 同一部署内 Source ID 必须唯一，所有地址、认证引用和信任策略均由此注入。
 */
export const deploymentProfileSchema = z
  .object({
    apiVersion: z.literal('harness.nova/v1'),
    kind: z.literal('DeploymentProfile'),
    metadata: z.object({
      id: identifierSchema,
      displayName: z.string().min(1).max(128),
      description: z.string().max(2_000).default(''),
    }),
    hub: z.object({
      url: z.string().url(),
      authRef: secretReferenceSchema.optional(),
      http: httpPolicySchema.default(defaultHttpPolicy),
    }),
    network: networkPolicySchema.default(defaultNetworkPolicy),
    downloads: downloadPolicySchema,
    sources: z.array(catalogSourceSchema).min(1),
    sync: z
      .object({
        schedule: z.string().min(1).default('0 */30 * * * *'),
        concurrency: z.number().int().min(1).max(32).default(4),
      })
      .default({ schedule: '0 */30 * * * *', concurrency: 4 }),
    runtime: z.object({
      default: identifierSchema.default('claude-code'),
      mode: z.enum(['integrated', 'isolated']).default('integrated'),
      configRoot: z.string().min(1).optional(),
    }),
    trust: z.object({
      allowUnreviewed: z.boolean().default(false),
      allowedMaintainerTeams: z.array(z.string().min(1)).default([]),
      requireApprovalAt: z.enum(['low', 'medium', 'high', 'critical']).default('high'),
    }),
  })
  .superRefine((profile, context) => {
    const ids = new Set<string>();
    for (const source of profile.sources) {
      if (ids.has(source.id)) {
        context.addIssue({
          code: 'custom',
          path: ['sources'],
          message: `duplicate source id: ${source.id}`,
        });
      }
      ids.add(source.id);
    }
  });

/** GitLab 目录来源配置类型。 */
export type GitLabSourceConfig = z.infer<typeof gitLabSourceSchema>;
/** npm 兼容目录来源配置类型。 */
export type NpmSourceConfig = z.infer<typeof npmSourceSchema>;
/** 所有目录来源的判别联合类型。 */
export type CatalogSourceConfig = z.infer<typeof catalogSourceSchema>;
/** 可跨内网复用的完整部署配置类型。 */
export type DeploymentProfile = z.infer<typeof deploymentProfileSchema>;
