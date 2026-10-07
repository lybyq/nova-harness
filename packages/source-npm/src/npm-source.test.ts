import type { NpmSourceConfig } from '@nova-cbb/harness-contracts';
import { describe, expect, it } from 'vitest';
import { NpmSource } from './npm-source.js';

const config: NpmSourceConfig = {
  id: 'npm-test',
  displayName: 'npm Test',
  enabled: true,
  type: 'npm',
  registry: 'https://registry.example.test',
  adapter: 'static-index',
  scopes: ['@nova'],
  packagePatterns: ['@nova/*-mcp'],
  seedPackages: ['@nova/jira-mcp', '@other/ignored'],
  manifestField: 'novaHarness',
  http: { timeoutMs: 2_000, retries: 1, retryBaseDelayMs: 1, concurrency: 2 },
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('NpmSource', () => {
  it('uses deterministic seeds, filters names, and marks missing manifests for review', async () => {
    const source = new NpmSource({
      config,
      secrets: { get: async () => undefined },
      fetch: async (input) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        expect(decodeURIComponent(url.pathname)).toBe('/@nova/jira-mcp');
        return json({
          name: '@nova/jira-mcp',
          description: 'Jira integration',
          maintainers: [{ name: 'platform' }],
          'dist-tags': { latest: '1.2.0' },
          versions: {
            '1.2.0': {
              name: '@nova/jira-mcp',
              version: '1.2.0',
              dist: {
                tarball: 'https://registry.example.test/@nova/jira-mcp/-/jira-mcp-1.2.0.tgz',
                integrity: 'sha512-test',
              },
            },
          },
        });
      },
    });
    const result = await source.discover();
    expect(result).toHaveLength(1);
    expect(result[0]?.capability).toMatchObject({
      id: 'jira',
      type: 'mcp',
      status: 'needs-review',
    });
    expect(result[0]?.capability.versions[0]?.integrity).toBe('sha512-test');
  });

  it('sends bearer authentication only to the configured registry host', async () => {
    let authorization: string | null = null;
    const source = new NpmSource({
      config: { ...config, authRef: 'TEST/NPM_TOKEN' },
      secrets: { get: async () => 'secret-token' },
      fetch: async (_input, init) => {
        authorization = new Headers(init?.headers).get('authorization');
        return json({
          name: '@nova/jira-mcp',
          'dist-tags': { latest: '1.0.0' },
          versions: {
            '1.0.0': {
              name: '@nova/jira-mcp',
              version: '1.0.0',
              dist: { tarball: 'https://registry.example.test/jira.tgz' },
            },
          },
        });
      },
    });
    await source.discover();
    expect(authorization).toBe('Bearer secret-token');
  });

  it('rejects a static index hosted outside the registry trust boundary', async () => {
    const source = new NpmSource({
      config: { ...config, staticIndexUrl: 'https://evil.example.test/index.json' },
      secrets: { get: async () => undefined },
      fetch: async () => json({ packages: [] }),
    });
    await expect(source.discover()).rejects.toMatchObject({
      code: 'UNTRUSTED_SOURCE',
    });
  });
});
