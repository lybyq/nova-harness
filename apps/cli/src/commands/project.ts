import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { projectProfileSchema, type ProjectProfile } from '@nova-cbb/harness-contracts';
import { HarnessError } from '@nova-cbb/harness-shared';
import { parse, stringify } from 'yaml';

/**
 * 初始化可提交到 Git 的项目 Profile 和本地 Lock 占位文件。
 *
 * Profile 只包含角色、能力覆盖和非敏感配置；Secret 必须通过 `nova secret` 保存。
 * 已存在时保持幂等，除非调用方显式允许覆盖。
 */
export async function initializeProject(directory: string, role = 'frontend', force = false) {
  const root = resolve(directory);
  const nova = resolve(root, '.nova');
  const profilePath = resolve(nova, 'profile.yaml');
  const lockPath = resolve(nova, 'harness.lock');
  if (!force && (await exists(profilePath)))
    throw new HarnessError({
      code: 'PLAN_CONFLICT',
      message: `${profilePath} 已存在`,
      hint: '使用 project status 查看，或显式传入 --force 重建。',
    });
  const profile: ProjectProfile = projectProfileSchema.parse({
    apiVersion: 'harness.nova/v1',
    kind: 'ProjectProfile',
    metadata: { name: root.split(/[\\/]/).pop() ?? 'project' },
    extends: [`roles/${role}`],
    capabilities: {},
    runtime: { default: 'claude-code', scope: 'project' },
    versionPolicy: {},
  });
  await mkdir(nova, { recursive: true });
  await writeFile(profilePath, stringify(profile), 'utf8');
  if (!(await exists(lockPath)))
    await writeFile(
      lockPath,
      `${JSON.stringify({ version: 1, generatedBy: 'nova-harness', capabilities: {} }, null, 2)}\n`,
      'utf8',
    );
  return {
    root,
    profilePath,
    lockPath,
    commitRecommended: ['.nova/profile.yaml', '.nova/harness.lock'],
    localOnly: ['.claude/settings.local.json'],
    secretPolicy: 'Secret 永远不写入项目文件',
  };
}

/** 读取并校验项目 Profile；未知字段或 Secret 值会被契约拒绝。 */
export async function readProject(
  directory: string,
): Promise<{ path: string; profile: ProjectProfile }> {
  const path = resolve(directory, '.nova', 'profile.yaml');
  try {
    return {
      path,
      profile: projectProfileSchema.parse(parse(await readFile(path, 'utf8')) as unknown),
    };
  } catch (error) {
    throw new HarnessError({
      code: 'CONFIG_INVALID',
      message: `项目 Profile 无法读取：${path}`,
      cause: error,
    });
  }
}

/** 返回项目声明状态，不接触用户级 Runtime 配置。 */
export async function projectStatus(directory: string) {
  const loaded = await readProject(directory);
  return {
    linked: true,
    ...loaded,
    lockExists: await exists(resolve(directory, '.nova', 'harness.lock')),
  };
}

/**
 * 解除项目与 Harness 的关联。
 * 仅删除 `.nova/profile.yaml` 和 `.nova/harness.lock`，目录中的其他用户文件保持不变。
 */
export async function unlinkProject(directory: string) {
  const targets = [
    resolve(directory, '.nova', 'profile.yaml'),
    resolve(directory, '.nova', 'harness.lock'),
  ];
  for (const target of targets) await rm(target, { force: true });
  return { unlinked: true, removed: targets };
}
async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}
