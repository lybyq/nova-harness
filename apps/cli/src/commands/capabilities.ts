import {
  capabilitySchema,
  type DesiredState,
  type StateIdentity,
} from '@nova-cbb/harness-contracts';
import { FileStateStore } from '@nova-cbb/harness-installer';
import { checksumOf, HarnessError } from '@nova-cbb/harness-shared';
import { access, readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type { HubClient } from '../hub/hub-client.js';
import { LocalCatalogStore } from '../config/local-catalog.js';
import { createLocalPlan } from './local-state.js';

/** 把能力加入 Desired State，版本固定为显式版本或 Catalog 推荐版本。 */
export async function addCapability(
  identity: StateIdentity,
  specification: string,
  hub: HubClient,
  options: { type?: 'mcp' | 'skill' | 'plugin'; allowUntrusted?: boolean } = {},
) {
  if (isLocalSpecification(specification)) {
    if (!options.allowUntrusted)
      throw new HarnessError({
        code: 'UNTRUSTED_SOURCE',
        message: '本地目录未经过 Hub 审核',
        hint: '检查目录内容后显式添加 --allow-untrusted。',
      });
    if (!options.type)
      throw new HarnessError({ code: 'CONFIG_INVALID', message: '本地目录必须指定 --type' });
    const capability = await localCapability(specification, options.type);
    await new LocalCatalogStore().put(capability);
    process.env.NOVA_ALLOW_LOCAL = 'yes';
    return addResolved(identity, capability);
  }
  const [rawId, requested] = splitSpecification(specification);
  const external = rawId.startsWith('npm:') || rawId.startsWith('git:');
  const capability = external
    ? await findExternalCapability(rawId, hub)
    : capabilitySchema.parse(await hub.capability(rawId));
  const id = capability.id;
  const version = requested
    ? capability.versions.find((item) => item.version === requested)
    : (capability.versions.find((item) => item.recommended) ?? capability.versions[0]);
  if (!version) throw new HarnessError({ code: 'NOT_FOUND', message: `${id} 没有可安装版本` });
  return addResolved(identity, capability, requested);
}

/** 把 npm:/git: 定位符解析到已经由可信 Hub 同步的能力，CLI 不绕过 Hub 临时遍历来源。 */
async function findExternalCapability(specification: string, hub: HubClient) {
  const locator = specification.replace(/^(npm|git):/, '');
  const page = await hub.catalog<{ data?: unknown[] }>(
    new URLSearchParams({ q: locator, page: '1', pageSize: '100' }),
  );
  for (const item of page.data ?? []) {
    const parsed = capabilitySchema.safeParse(item);
    if (
      parsed.success &&
      (parsed.data.source.locator === locator || parsed.data.source.packageName === locator)
    )
      return parsed.data;
  }
  throw new HarnessError({
    code: 'NOT_FOUND',
    message: `Hub 尚未发现来源：${locator}`,
    hint: '先执行 nova hub sync；直接 Git/npm 来源仍必须进入可信 Hub Catalog。',
  });
}

async function addResolved(
  identity: StateIdentity,
  capability: ReturnType<typeof capabilitySchema.parse>,
  requested?: string,
) {
  const id = capability.id;
  const version = requested
    ? capability.versions.find((item) => item.version === requested)
    : (capability.versions.find((item) => item.recommended) ?? capability.versions[0]);
  if (!version) throw new HarnessError({ code: 'NOT_FOUND', message: `${id} 没有可安装版本` });
  return mutate(identity, (desired) => ({
    ...desired,
    capabilities: [
      ...desired.capabilities.filter((item) => item.id !== id),
      { id, version: version.version, reason: ['user:add'], enabled: true, configuration: {} },
    ],
    overrides: {
      ...desired.overrides,
      add: [
        ...desired.overrides.add.filter((item) => item.id !== id),
        { id, range: version.version, reason: 'user:add', configuration: {} },
      ],
      remove: desired.overrides.remove.filter((item) => item !== id),
    },
  }));
}

/** 从 Desired State 删除能力；角色 required 依赖必须先切换角色或修改角色定义。 */
export async function removeCapability(identity: StateIdentity, id: string) {
  return mutate(identity, (desired) => {
    const current = desired.capabilities.find((item) => item.id === id);
    if (current?.reason.some((reason) => reason.includes(':required')))
      throw new HarnessError({
        code: 'PLAN_CONFLICT',
        message: `${id} 是当前角色的必选能力，不能直接删除`,
        hint: '请修改角色或切换角色。',
      });
    return {
      ...desired,
      capabilities: desired.capabilities.filter((item) => item.id !== id),
      overrides: {
        ...desired.overrides,
        add: desired.overrides.add.filter((item) => item.id !== id),
        remove: [...new Set([...desired.overrides.remove, id])],
        disable: desired.overrides.disable.filter((item) => item !== id),
      },
    };
  });
}

/** 启用或禁用能力；禁用不会删除 Store 和配置。 */
export async function setCapabilityEnabled(identity: StateIdentity, id: string, enabled: boolean) {
  return mutate(identity, (desired) => {
    if (!desired.capabilities.some((item) => item.id === id))
      throw new HarnessError({ code: 'NOT_FOUND', message: `Desired State 中不存在 ${id}` });
    return {
      ...desired,
      capabilities: desired.capabilities.map((item) =>
        item.id === id ? { ...item, enabled } : item,
      ),
      overrides: {
        ...desired.overrides,
        disable: enabled
          ? desired.overrides.disable.filter((item) => item !== id)
          : [...new Set([...desired.overrides.disable, id])],
      },
    };
  });
}

/** 更新一个能力到推荐版本；返回的 Plan 仍需显式 Apply。 */
export async function updateCapability(identity: StateIdentity, id: string, hub: HubClient) {
  const capability = capabilitySchema.parse(await hub.capability(id));
  const version = capability.versions.find((item) => item.recommended);
  if (!version) throw new HarnessError({ code: 'NOT_FOUND', message: `${id} 没有推荐版本` });
  return mutate(identity, (desired) => ({
    ...desired,
    capabilities: desired.capabilities.map((item) =>
      item.id === id ? { ...item, version: version.version } : item,
    ),
  }));
}

/** 检查当前 Desired State 与 Catalog 推荐版本的差异，不修改本地状态。 */
export async function checkUpdates(identity: StateIdentity, hub: HubClient) {
  const desired = await new FileStateStore().readDesired(identity);
  if (!desired) throw new HarnessError({ code: 'CONFIG_INVALID', message: '请先执行 nova init' });
  const updates = [];
  for (const current of desired.capabilities) {
    const capability = capabilitySchema.parse(await hub.capability(current.id));
    const recommended = capability.versions.find((item) => item.recommended);
    if (recommended && recommended.version !== current.version)
      updates.push({ id: current.id, current: current.version, available: recommended.version });
  }
  return updates;
}

/** 把全部能力更新到推荐版本并生成一个聚合 Plan。 */
export async function updateAllCapabilities(identity: StateIdentity, hub: HubClient) {
  const updates = await checkUpdates(identity, hub);
  const store = new FileStateStore();
  const current = await store.readDesired(identity);
  if (!current) throw new HarnessError({ code: 'CONFIG_INVALID', message: '请先执行 nova init' });
  const versions = new Map(updates.map((item) => [item.id, item.available]));
  return mutate(identity, (desired) => ({
    ...desired,
    capabilities: desired.capabilities.map((item) =>
      versions.has(item.id) ? { ...item, version: versions.get(item.id)! } : item,
    ),
  }));
}

async function mutate(
  identity: StateIdentity,
  change: (desired: DesiredState) => Omit<DesiredState, 'checksum'> | DesiredState,
) {
  const store = new FileStateStore();
  const current = await store.readDesired(identity);
  if (!current) throw new HarnessError({ code: 'CONFIG_INVALID', message: '请先执行 nova init' });
  const changed = change(current);
  const withoutChecksum = { ...changed, checksum: undefined };
  const desired: DesiredState = { ...changed, checksum: checksumOf(withoutChecksum) };
  await store.writeDesired(desired);
  return createLocalPlan(identity);
}
function splitSpecification(value: string): [string, string | undefined] {
  const index = value.lastIndexOf('@');
  if (value.startsWith('npm:@') && index === 'npm:'.length) return [value, undefined];
  if (index > 0) return [value.slice(0, index), value.slice(index + 1)];
  return [value, undefined];
}

function isLocalSpecification(value: string): boolean {
  return value.startsWith('.') || value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
}

/** 从本地目录入口生成最小、可校验且版本固定的 Capability 定义。 */
async function localCapability(pathValue: string, type: 'mcp' | 'skill' | 'plugin') {
  const directory = resolve(pathValue);
  const required =
    type === 'skill'
      ? 'SKILL.md'
      : type === 'plugin'
        ? '.claude-plugin/plugin.json'
        : 'package.json';
  const entry = resolve(directory, required);
  if (
    !(await access(entry).then(
      () => true,
      () => false,
    ))
  )
    throw new HarnessError({ code: 'CONFIG_INVALID', message: `本地目录缺少 ${required}` });
  const content = await readFile(entry, 'utf8');
  const id = basename(directory)
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-');
  const checksum = checksumOf(content);
  return capabilitySchema.parse({
    id,
    type,
    name: id,
    displayName: id,
    description: '用户显式添加的本地能力',
    tags: ['local'],
    categories: [],
    maintainers: [],
    status: 'active',
    riskLevel: 'high',
    source: { sourceId: 'local-user', kind: 'local', locator: directory },
    versions: [
      {
        version: `0.0.0-local.${checksum.slice(0, 12)}`,
        recommended: true,
        manifestChecksum: checksum,
        dependencies: [],
        conflicts: [],
        runtimeBindings: { 'claude-code': { type } },
      },
    ],
    secrets: [],
    configuration: [],
    sourceMetadata: { local: true, entry: required },
    adminOverrides: {},
  });
}
