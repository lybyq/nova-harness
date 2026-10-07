import { Injectable } from '@nestjs/common';
import {
  catalogSourceSchema,
  deploymentProfileSchema,
  type CatalogSourceConfig,
  type DeploymentProfile,
} from '@nova-cbb/harness-contracts';
import { HarnessError } from '@nova-cbb/harness-shared';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse, stringify } from 'yaml';

/** Deployment Profile 的读取、Schema 校验、缓存和来源原子更新服务。 */
@Injectable()
/** Deployment Profile 的读取、Schema 校验和来源原子更新服务。 */
export class DeploymentService {
  #cached: DeploymentProfile | undefined;

  async get(): Promise<DeploymentProfile> {
    if (this.#cached) return this.#cached;
    const configured = process.env.NOVA_DEPLOYMENT_CONFIG;
    const path = resolve(configured ?? 'manifests/deployments/public-smoke.yaml');
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      throw new HarnessError({
        code: 'CONFIG_INVALID',
        message: `Deployment profile could not be read: ${path}`,
        cause: error,
      });
    }
    const result = deploymentProfileSchema.safeParse(parse(text));
    if (!result.success) {
      throw new HarnessError({
        code: 'CONFIG_INVALID',
        message: `Deployment profile is invalid: ${path}`,
        details: { issues: result.error.issues },
      });
    }
    this.#cached = result.data;
    return result.data;
  }

  /** 原子更新单个来源；Secret 只能以 authRef 引用存在，写入前重新校验整个 Profile。 */
  async updateSource(id: string, input: unknown): Promise<CatalogSourceConfig> {
    const source = catalogSourceSchema.parse({ ...(isRecord(input) ? input : {}), id });
    const current = await this.get();
    if (!current.sources.some((item) => item.id === id))
      throw new HarnessError({ code: 'NOT_FOUND', message: `Source ${id} was not found` });
    const next = deploymentProfileSchema.parse({
      ...current,
      sources: current.sources.map((item) => (item.id === id ? source : item)),
    });
    const path = resolve(
      process.env.NOVA_DEPLOYMENT_CONFIG ?? 'manifests/deployments/public-smoke.yaml',
    );
    const temporary = `${path}.${process.pid}.tmp`;
    try {
      await writeFile(temporary, stringify(next), { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, path);
      this.#cached = next;
      return source;
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
