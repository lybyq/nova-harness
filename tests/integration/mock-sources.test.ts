import { spawn, type ChildProcess } from 'node:child_process';
import type { GitLabSourceConfig, NpmSourceConfig } from '@nova-cbb/harness-contracts';
import { GitLabSource } from '@nova-cbb/source-gitlab';
import { NpmSource } from '@nova-cbb/source-npm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const port = 35_000 + Math.floor(Math.random() * 2_000);
const origin = `http://127.0.0.1:${port}`;
let processHandle: ChildProcess;

beforeAll(async () => {
  processHandle = spawn(process.execPath, ['--import', 'tsx', 'apps/mock-server/src/server.ts'], {
    cwd: process.cwd(),
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NOVA_MOCK_PORT: String(port), NOVA_MOCK_ORIGIN: origin },
  });
  await waitForHealth();
}, 20_000);

afterAll(() => {
  processHandle?.kill('SIGTERM');
});

describe('Mock GitLab/npm 集成环境', () => {
  it('跨分页发现普通与嵌套 Skill、Plugin，并读取 Manifest、成员和 Tag', async () => {
    const config: GitLabSourceConfig = {
      id: 'mock-gitlab',
      displayName: 'Mock GitLab',
      enabled: true,
      type: 'gitlab',
      baseUrl: origin,
      apiPath: '/api/v4',
      rootGroup: 'nova',
      skillGroupPath: 'skills',
      pluginGroupPath: 'plugins',
      recursive: true,
      includeSharedProjects: false,
      manifestPath: 'nova.manifest.yaml',
      http: { timeoutMs: 3_000, retries: 1, retryBaseDelayMs: 10, concurrency: 2 },
    };
    const discovered = await new GitLabSource({
      config,
      secrets: { get: async () => undefined },
    }).discover();

    expect(discovered.map((item) => item.project.path)).toEqual([
      'mock-skill',
      'nested/mock-nested-skill',
      'mock-plugin',
    ]);
    expect(discovered.every((item) => item.entryExists && item.tags.length === 1)).toBe(true);
    expect(discovered.every((item) => item.maintainers[0]?.name === 'Nova Maintainer')).toBe(true);
  });

  it('从 npm 搜索端点发现 MCP 并保留 tarball 与 integrity', async () => {
    const config: NpmSourceConfig = {
      id: 'mock-npm',
      displayName: 'Mock npm',
      enabled: true,
      type: 'npm',
      registry: origin,
      adapter: 'npm-compatible',
      scopes: ['@nova-cbb'],
      packagePatterns: ['@nova-cbb/*'],
      seedPackages: [],
      manifestField: 'novaHarness',
      http: { timeoutMs: 3_000, retries: 1, retryBaseDelayMs: 10, concurrency: 2 },
    };
    const discovered = await new NpmSource({
      config,
      secrets: { get: async () => undefined },
    }).discover();

    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.capability).toMatchObject({
      id: 'mock-mcp',
      type: 'mcp',
      status: 'active',
    });
    expect(discovered[0]?.capability.versions[0]).toMatchObject({
      version: '1.0.0',
      integrity: expect.stringMatching(/^sha512-/),
      artifact: { kind: 'npm-tarball', url: `${origin}/artifacts/mock-mcp-1.0.0.tgz` },
    });
  });
});

/** 等待 Mock 端口真正可用，避免仅依赖子进程启动事件造成竞争。 */
async function waitForHealth(): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (processHandle.exitCode !== null)
      throw new Error(`Mock Server 提前退出：${processHandle.exitCode}`);
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Mock Server 启动超时：${String(lastError)}`);
}
