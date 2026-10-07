import { z } from 'zod';
import { identifierSchema, semverRangeSchema } from './common.js';
import { profileOverridesSchema } from './profile.js';

/** 项目级 Profile：只保存可提交的声明，不允许出现 Secret 值。 */
export const projectProfileSchema = z.object({
  apiVersion: z.literal('harness.nova/v1'),
  kind: z.literal('ProjectProfile'),
  metadata: z.object({ name: z.string().min(1), description: z.string().default('') }),
  extends: z.array(z.string().regex(/^roles\/[a-z0-9][a-z0-9._-]*$/)).min(1),
  capabilities: profileOverridesSchema
    .pick({ add: true, remove: true, disable: true, configuration: true })
    .default({ add: [], remove: [], disable: [], configuration: {} }),
  runtime: z.object({
    default: identifierSchema.default('claude-code'),
    scope: z.literal('project'),
  }),
  versionPolicy: z
    .object({ defaultRange: semverRangeSchema.default('*') })
    .default({ defaultRange: '*' }),
});

/** 可提交到项目仓库且不包含 Secret 明文的项目 Profile 类型。 */
export type ProjectProfile = z.infer<typeof projectProfileSchema>;
