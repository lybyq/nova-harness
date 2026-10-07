import { readFile } from 'node:fs/promises';
import {
  roleProfileSchema,
  type RoleProfile,
  type StateIdentity,
} from '@nova-cbb/harness-contracts';
import { FileStateStore } from '@nova-cbb/harness-installer';
import { HarnessError } from '@nova-cbb/harness-shared';
import { parse } from 'yaml';
import type { HubClient } from '../hub/hub-client.js';
import { setRoleDesired } from './local-state.js';

/** 返回当前作用域已选择的角色；未初始化时给出可操作错误。 */
export async function currentRole(identity: StateIdentity) {
  const desired = await new FileStateStore().readDesired(identity);
  if (!desired) throw new HarnessError({ code: 'CONFIG_INVALID', message: '当前作用域尚未初始化' });
  return {
    id: desired.roleId,
    version: desired.roleVersion,
    capabilities: desired.capabilities.length,
  };
}

/** 解析目标角色但不写入 Desired State，用于展示角色切换差异。 */
export async function diffRole(identity: StateIdentity, target: string, hub: HubClient) {
  const store = new FileStateStore();
  const current = await store.readDesired(identity);
  const resolved = await hub.resolve<{ capabilities: Array<{ id: string; version: string }> }>({
    runtime: identity.runtimeId,
    role: target,
    scope: identity.scope,
  });
  const before = new Map((current?.capabilities ?? []).map((item) => [item.id, item.version]));
  const after = new Map(resolved.capabilities.map((item) => [item.id, item.version]));
  return {
    add: [...after].filter(([id]) => !before.has(id)),
    remove: [...before].filter(([id]) => !after.has(id)),
    update: [...after].filter(([id, version]) => before.has(id) && before.get(id) !== version),
  };
}

/** 创建最小可编辑角色草稿，能力映射为空而不是硬编码企业资产 ID。 */
export function createRoleDocument(id: string): RoleProfile {
  return roleProfileSchema.parse({
    apiVersion: 'harness.nova/v1',
    kind: 'RoleProfile',
    metadata: { id, displayName: id, description: '', version: '0.1.0' },
    extends: [],
    runtime: { default: 'claude-code' },
    capabilities: {},
    permissions: [],
    defaults: { mappingStatus: 'pending' },
  });
}

/** 克隆角色并重置为未发布的 0.1.0 版本。 */
export async function cloneRole(source: string, target: string, hub: HubClient) {
  const original = roleProfileSchema.parse(await hub.role(source));
  const clone = roleProfileSchema.parse({
    ...original,
    metadata: { ...original.metadata, id: target, displayName: target, version: '0.1.0' },
  });
  return hub.createRole(clone);
}

/** 从 YAML/JSON 文件读取、校验并更新角色。 */
export async function editRole(id: string, path: string, hub: HubClient) {
  const document = roleProfileSchema.parse(parse(await readFile(path, 'utf8')) as unknown);
  if (document.metadata.id !== id)
    throw new HarnessError({
      code: 'CONFIG_INVALID',
      message: `文件中的角色 ID ${document.metadata.id} 与命令参数 ${id} 不一致`,
    });
  return hub.updateRole(id, document);
}

/** 切换角色并生成 Plan；CLI 根据 `--dry-run` 决定预览或立即事务应用。 */
export function useRole(identity: StateIdentity, id: string, hub: HubClient) {
  return setRoleDesired(identity, id, hub);
}
