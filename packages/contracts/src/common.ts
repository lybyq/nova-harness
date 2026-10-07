import { z } from 'zod';

/** 校验跨 Hub、CLI 和 Lock 稳定使用的小写标识符。 */
export const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'must be a lowercase stable identifier');

/** 校验非空且有限长度的 SemVer 范围文本，语义解析由 Resolver 完成。 */
export const semverRangeSchema = z.string().min(1).max(128);

/** 校验 Secret 引用键；该 Schema 特意不允许把明文值混入配置。 */
export const secretReferenceSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Z0-9][A-Z0-9_:/.-]*$/, 'must be a non-secret reference key');

/** 校验统一 HTTP 超时、重试、退避和并发策略。 */
export const httpPolicySchema = z.object({
  timeoutMs: z.number().int().min(100).max(300_000).default(15_000),
  retries: z.number().int().min(0).max(10).default(2),
  retryBaseDelayMs: z.number().int().min(10).max(30_000).default(250),
  concurrency: z.number().int().min(1).max(32).default(4),
});

/** 网络客户端共同使用的保守默认 HTTP 策略。 */
export const defaultHttpPolicy: {
  timeoutMs: number;
  retries: number;
  retryBaseDelayMs: number;
  concurrency: number;
} = {
  timeoutMs: 15_000,
  retries: 2,
  retryBaseDelayMs: 250,
  concurrency: 4,
};

/** 校验代理、自定义 CA 与 TLS 验证策略。 */
export const networkPolicySchema = z.object({
  proxyUrl: z.string().url().optional(),
  noProxy: z.array(z.string().min(1)).default([]),
  caFile: z.string().min(1).optional(),
  rejectUnauthorized: z.boolean().default(true),
});

/** 默认启用 TLS 证书验证，避免配置缺省时静默降级。 */
export const defaultNetworkPolicy: {
  noProxy: string[];
  rejectUnauthorized: boolean;
} = {
  noProxy: [],
  rejectUnauthorized: true,
};

/** 校验下载来源白名单、解压资源上限和安装脚本安全策略。 */
export const downloadPolicySchema = z.object({
  allowedHosts: z.array(z.string().min(1)).min(1),
  allowedRedirectHosts: z.array(z.string().min(1)).default([]),
  maxArchiveBytes: z
    .number()
    .int()
    .positive()
    .default(100 * 1024 * 1024),
  maxExtractedBytes: z
    .number()
    .int()
    .positive()
    .default(500 * 1024 * 1024),
  maxFiles: z.number().int().positive().default(20_000),
  allowLifecycleScripts: z.boolean().default(false),
});

/** HTTP 重试与并发策略的静态类型。 */
export type HttpPolicy = z.infer<typeof httpPolicySchema>;
/** 网络代理和 TLS 策略的静态类型。 */
export type NetworkPolicy = z.infer<typeof networkPolicySchema>;
/** 安全下载与解压上限策略的静态类型。 */
export type DownloadPolicy = z.infer<typeof downloadPolicySchema>;
