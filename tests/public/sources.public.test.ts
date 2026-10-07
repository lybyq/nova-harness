import type { GitLabSourceConfig, NpmSourceConfig } from '@nova-cbb/harness-contracts';
import { GitLabSource } from '@nova-cbb/source-gitlab';
import { NpmSource } from '@nova-cbb/source-npm';
import { describe, expect, it } from 'vitest';

const noSecrets = { get: async (): Promise<undefined> => undefined };

const gitLabConfig: GitLabSourceConfig = {
  id: 'public-gitlab',
  displayName: 'GitLab.com',
  enabled: true,
  type: 'gitlab',
  baseUrl: 'https://gitlab.com',
  apiPath: '/api/v4',
  rootGroup: 'gitlab-org',
  skillGroupPath: 'skills',
  pluginGroupPath: 'plugins',
  recursive: true,
  includeSharedProjects: false,
  manifestPath: 'nova.manifest.yaml',
  http: { timeoutMs: 20_000, retries: 1, retryBaseDelayMs: 500, concurrency: 1 },
};

const npmConfig: NpmSourceConfig = {
  id: 'public-npm',
  displayName: 'npmjs.org',
  enabled: true,
  type: 'npm',
  registry: 'https://registry.npmjs.org',
  adapter: 'static-index',
  scopes: ['@modelcontextprotocol'],
  packagePatterns: ['@modelcontextprotocol/server-*'],
  seedPackages: ['@modelcontextprotocol/server-filesystem'],
  manifestField: 'novaHarness',
  http: { timeoutMs: 20_000, retries: 1, retryBaseDelayMs: 500, concurrency: 1 },
};

describe('public source smoke tests', () => {
  it('reads a public GitLab group through the real API', async () => {
    const result = await new GitLabSource({ config: gitLabConfig, secrets: noSecrets }).ping();
    expect(result.reachable).toBe(true);
    expect(result.rootGroupId).toBeGreaterThan(0);
  });

  it('reads scoped npm metadata, versions, tarball host, and integrity', async () => {
    const [result] = await new NpmSource({ config: npmConfig, secrets: noSecrets }).discover();
    expect(result?.name).toBe('@modelcontextprotocol/server-filesystem');
    expect(result?.capability.status).toBe('needs-review');
    expect(result?.capability.versions.some((version) => Boolean(version.integrity))).toBe(true);
    expect(result?.capability.sourceMetadata.tarballHost).toBe('registry.npmjs.org');
  });
});
