import type { GitLabSourceConfig } from '@nova-cbb/harness-contracts';
import { describe, expect, it } from 'vitest';
import { GitLabSource } from './gitlab-source.js';

const config: GitLabSourceConfig = {
  id: 'gitlab-test',
  displayName: 'GitLab Test',
  enabled: true,
  type: 'gitlab',
  baseUrl: 'https://gitlab.example.test',
  apiPath: '/api/v4',
  rootGroup: 'nova',
  skillGroupPath: 'skills',
  pluginGroupPath: 'plugins',
  recursive: true,
  includeSharedProjects: false,
  manifestPath: 'nova.manifest.yaml',
  http: { timeoutMs: 2_000, retries: 1, retryBaseDelayMs: 1, concurrency: 2 },
};

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('GitLabSource', () => {
  it('discovers paginated skill and plugin projects and treats missing manifests as absence', async () => {
    const requests: URL[] = [];
    const fetch = async (input: string | URL | Request): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      requests.push(url);
      const path = decodeURIComponent(url.pathname);
      if (path.endsWith('/groups/nova/skills')) return json({ id: 10, full_path: 'nova/skills' });
      if (path.endsWith('/groups/nova/plugins')) return json({ id: 20, full_path: 'nova/plugins' });
      if (path.endsWith('/groups/10/projects') && url.searchParams.get('page') === '1') {
        return json([project(101, 'skill-a')], 200, { 'x-next-page': '2' });
      }
      if (path.endsWith('/groups/10/projects')) return json([]);
      if (path.endsWith('/groups/20/projects')) return json([project(202, 'plugin-a')]);
      if (path.includes('/repository/files/nova.manifest.yaml')) return json({}, 404);
      if (path.includes('/repository/files/README.md')) return json({}, 404);
      if (path.endsWith('/members/all')) return json([]);
      if (path.includes('/repository/files/SKILL.md')) {
        return json({ encoding: 'base64', content: Buffer.from('# Skill').toString('base64') });
      }
      if (path.includes('/repository/files/.claude-plugin/plugin.json')) {
        return json({ encoding: 'base64', content: Buffer.from('{}').toString('base64') });
      }
      if (path.endsWith('/repository/commits')) return json([{ id: 'a'.repeat(40) }]);
      if (path.endsWith('/repository/tags')) return json([]);
      throw new Error(`Unexpected request: ${url.toString()}`);
    };

    const source = new GitLabSource({ config, secrets: { get: async () => undefined }, fetch });
    const result = await source.discover();
    expect(result.map((item) => [item.capabilityType, item.project.path])).toEqual([
      ['skill', 'skill-a'],
      ['plugin', 'plugin-a'],
    ]);
    expect(result.every((item) => item.entryExists && item.manifestContent === undefined)).toBe(
      true,
    );
    expect(requests.some((url) => url.searchParams.get('page') === '2')).toBe(true);
  });

  it('uses a secret reference without exposing it in the URL', async () => {
    let privateToken: string | null = null;
    const source = new GitLabSource({
      config: { ...config, authRef: 'TEST/GITLAB_TOKEN' },
      secrets: { get: async () => 'very-secret' },
      fetch: async (input, init) => {
        privateToken = new Headers(init?.headers).get('private-token');
        const url = new URL(input instanceof Request ? input.url : input.toString());
        expect(url.toString()).not.toContain('very-secret');
        return json({ id: 1, full_path: 'nova' });
      },
    });
    await source.ping();
    expect(privateToken).toBe('very-secret');
  });
});

function project(id: number, path: string) {
  return {
    id,
    name: path,
    path,
    path_with_namespace: `nova/${path}`,
    description: null,
    default_branch: 'main',
    archived: false,
    visibility: 'private',
    topics: [],
    last_activity_at: new Date(0).toISOString(),
    web_url: `https://gitlab.example.test/nova/${path}`,
  };
}
