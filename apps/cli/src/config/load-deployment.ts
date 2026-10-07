import { deploymentProfileSchema, type DeploymentProfile } from '@nova-cbb/harness-contracts';
import { HarnessError } from '@nova-cbb/harness-shared';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { HubRegistryStore } from './hub-registry.js';
import { RuntimePreferenceStore } from './runtime-preference.js';

/**
 * 读取并校验 Deployment Profile，再叠加用户选择的 Hub 与 Runtime 偏好。
 * @throws {HarnessError} 文件缺失或 Schema 无效时返回可操作的配置错误。
 */
export async function loadDeployment(pathValue?: string): Promise<{
  path: string;
  profile: DeploymentProfile;
}> {
  const path = resolve(
    pathValue ?? process.env.NOVA_DEPLOYMENT_CONFIG ?? 'manifests/deployments/public-smoke.yaml',
  );
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new HarnessError({
      code: 'CONFIG_INVALID',
      message: `无法读取 Deployment Profile：${path}`,
      hint: '使用 --config <path> 指定配置文件。',
      cause: error,
    });
  }
  const result = deploymentProfileSchema.safeParse(parse(text));
  if (!result.success) {
    throw new HarnessError({
      code: 'CONFIG_INVALID',
      message: `Deployment Profile 校验失败：${path}`,
      details: { issues: result.error.issues },
    });
  }
  const registry = await new HubRegistryStore().read();
  const hubName = process.env.NOVA_HUB_NAME ?? registry.active;
  const override = hubName ? registry.hubs[hubName] : undefined;
  const runtimeStore = new RuntimePreferenceStore();
  const [savedRuntime, mode] = await Promise.all([runtimeStore.read(), runtimeStore.readMode()]);
  const runtime = process.env.NOVA_RUNTIME_ID ?? savedRuntime;
  const profile = override
    ? { ...result.data, hub: { ...result.data.hub, ...override } }
    : result.data;
  return {
    path,
    profile:
      runtime || mode
        ? {
            ...profile,
            runtime: {
              ...profile.runtime,
              ...(runtime ? { default: runtime } : {}),
              ...(mode ? { mode } : {}),
            },
          }
        : profile,
  };
}
