import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as tar from 'tar';

const port = Number(process.env.NOVA_MOCK_PORT ?? 3400);
const origin = process.env.NOVA_MOCK_ORIGIN ?? `http://localhost:${port}`;
const root = await mkdtemp(join(tmpdir(), 'nova-harness-mock-'));
const fixtures = await prepareFixtures(root);

/**
 * 提供确定性的 GitLab v4 与 npm Registry 只读子集。
 * 所有响应均来自进程启动时生成的固定制品，不需要外网凭据，专用于 Compose/E2E。
 */
const server = createServer((request, response) => {
  void route(request, response).catch((error: unknown) => {
    json(response, 500, { error: error instanceof Error ? error.message : 'mock failure' });
  });
});
server.listen(port, '0.0.0.0', () => process.stdout.write(`Nova mock listening on ${port}\n`));
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => server.close(() => void rm(root, { recursive: true, force: true })));

/** 路由 GitLab/npm 元数据与二进制制品下载。 */
async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', origin);
  const path = decodeURIComponent(url.pathname);
  if (path === '/health' || path === '/-/ping') return json(response, 200, { ok: true });
  if (path === '/api/v4/groups/nova') return json(response, 200, { id: 1, full_path: 'nova' });
  if (path === '/api/v4/groups/nova/skills')
    return json(response, 200, { id: 10, full_path: 'nova/skills' });
  if (path === '/api/v4/groups/nova/plugins')
    return json(response, 200, { id: 20, full_path: 'nova/plugins' });
  if (path === '/api/v4/groups/10/projects')
    return url.searchParams.get('page') === '2'
      ? json(response, 200, [gitProject(102, 'nested/mock-nested-skill')], {
          'x-next-page': '',
        })
      : json(response, 200, [gitProject(101, 'mock-skill')], { 'x-next-page': '2' });
  if (path === '/api/v4/groups/20/projects')
    return json(response, 200, [gitProject(202, 'mock-plugin')], { 'x-next-page': '' });
  const project = /\/api\/v4\/projects\/(101|102|202)(\/.*)?$/.exec(path);
  if (project) return gitProjectRoute(Number(project[1]), project[2] ?? '', url, response);
  if (path === '/-/v1/search')
    return json(response, 200, {
      objects: [{ package: { name: '@nova-cbb/mock-mcp' } }],
      total: 1,
    });
  if (path === '/@nova-cbb/mock-mcp' || path === '/@nova-cbb%2fmock-mcp')
    return json(response, 200, npmPackument());
  if (path === '/-/nova-index.json')
    return json(response, 200, { packages: ['@nova-cbb/mock-mcp'] });
  if (path === '/artifacts/mock-mcp-1.0.0.tgz') return binary(response, fixtures.mcpArchive);
  json(response, 404, { message: `mock route not found: ${path}` });
}

/** 返回单个 GitLab 项目的仓库、Tag、成员与 Archive API。 */
async function gitProjectRoute(
  id: number,
  suffix: string,
  url: URL,
  response: ServerResponse,
): Promise<void> {
  if (suffix === '/repository/tags')
    return json(response, 200, [
      { name: 'v1.0.0', target: commit(id), commit: { id: commit(id) } },
    ]);
  if (suffix === '/repository/commits') return json(response, 200, [{ id: commit(id) }]);
  if (suffix === '/members/all')
    return json(response, 200, [{ name: 'Nova Maintainer', username: 'nova-maintainer' }]);
  if (suffix === '/repository/archive.tar.gz')
    return binary(response, id === 202 ? fixtures.pluginArchive : fixtures.skillArchive);
  const file = /\/repository\/files\/(.+)$/.exec(suffix)?.[1];
  if (file) {
    const content = fixtures.gitFiles.get(`${id}:${file}`);
    return content === undefined
      ? json(response, 404, { message: '404 File Not Found' })
      : json(response, 200, {
          encoding: 'base64',
          content: Buffer.from(content).toString('base64'),
        });
  }
  json(response, 404, { message: `unknown project route ${url.pathname}` });
}

function gitProject(id: number, path: string) {
  return {
    id,
    name: path,
    path,
    path_with_namespace: `nova/${id === 202 ? 'plugins' : 'skills'}/${path}`,
    description: `Deterministic ${path} fixture`,
    default_branch: 'main',
    archived: false,
    visibility: 'private',
    topics: ['mock', 'e2e'],
    last_activity_at: '2026-01-01T00:00:00.000Z',
    web_url: `${origin}/nova/${path}`,
  };
}

function commit(id: number): string {
  return String(id).padStart(40, 'a').slice(-40);
}

function npmPackument() {
  return {
    name: '@nova-cbb/mock-mcp',
    description: 'Deterministic MCP fixture',
    maintainers: [{ name: 'Nova Maintainer' }],
    'dist-tags': { latest: '1.0.0' },
    versions: {
      '1.0.0': {
        name: '@nova-cbb/mock-mcp',
        version: '1.0.0',
        bin: { 'mock-mcp': 'server.js' },
        dist: {
          tarball: `${origin}/artifacts/mock-mcp-1.0.0.tgz`,
          integrity: fixtures.mcpIntegrity,
        },
        novaHarness: {
          id: 'mock-mcp',
          displayName: 'Mock MCP',
          description: '用于 E2E 的只读 MCP Server',
          tags: ['mock'],
        },
      },
    },
  };
}

/** 生成包含真实入口文件的 tar.gz，确保安装器会走完整下载、解压和校验路径。 */
async function prepareFixtures(directory: string) {
  const gitFiles = new Map<string, string>();
  const skillManifest = `metadata:\n  id: mock-skill\n  displayName: Mock Skill\n  description: 用于 E2E 的 Skill\n`;
  const pluginManifest = `metadata:\n  id: mock-plugin\n  displayName: Mock Plugin\n  description: 用于 E2E 的 Plugin\n`;
  const skillMd = `---\nname: mock-skill\ndescription: Deterministic E2E skill\n---\n\n# Mock Skill\n`;
  const pluginJson = `${JSON.stringify({ name: 'mock-plugin', description: 'Deterministic E2E plugin' }, null, 2)}\n`;
  gitFiles.set('101:nova.manifest.yaml', skillManifest);
  gitFiles.set('101:SKILL.md', skillMd);
  gitFiles.set('101:README.md', '# Mock Skill\n\nDeterministic GitLab fixture.\n');
  gitFiles.set(
    '102:nova.manifest.yaml',
    skillManifest
      .replaceAll('mock-skill', 'mock-nested-skill')
      .replace('Mock Skill', 'Mock Nested Skill'),
  );
  gitFiles.set('102:SKILL.md', skillMd.replaceAll('mock-skill', 'mock-nested-skill'));
  gitFiles.set('102:README.md', '# Mock Nested Skill\n\nNested subgroup fixture.\n');
  gitFiles.set('202:nova.manifest.yaml', pluginManifest);
  gitFiles.set('202:.claude-plugin/plugin.json', pluginJson);
  gitFiles.set('202:README.md', '# Mock Plugin\n\nDeterministic GitLab fixture.\n');
  const skillArchive = resolve(directory, 'skill.tgz');
  const pluginArchive = resolve(directory, 'plugin.tgz');
  const mcpArchive = resolve(directory, 'mcp.tgz');
  await archive(directory, 'skill-root', skillArchive, {
    'nova.manifest.yaml': skillManifest,
    'SKILL.md': skillMd,
  });
  await archive(directory, 'plugin-root', pluginArchive, {
    'nova.manifest.yaml': pluginManifest,
    '.claude-plugin/plugin.json': pluginJson,
  });
  await archive(directory, 'package', mcpArchive, {
    'package.json': `${JSON.stringify({ name: '@nova-cbb/mock-mcp', version: '1.0.0', type: 'module', bin: { 'mock-mcp': 'server.js' } }, null, 2)}\n`,
    'server.js': `#!/usr/bin/env node\nimport readline from 'node:readline';\nconst rl=readline.createInterface({input:process.stdin});rl.on('line',(line)=>{const r=JSON.parse(line);if(r.id===1)console.log(JSON.stringify({jsonrpc:'2.0',id:1,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'mock',version:'1.0.0'}}}));if(r.id===2)console.log(JSON.stringify({jsonrpc:'2.0',id:2,result:{tools:[]}}));});\n`,
  });
  const mcpIntegrity = `sha512-${createHash('sha512')
    .update(await readFile(mcpArchive))
    .digest('base64')}`;
  return { gitFiles, skillArchive, pluginArchive, mcpArchive, mcpIntegrity };
}

async function archive(
  directory: string,
  name: string,
  target: string,
  files: Record<string, string>,
): Promise<void> {
  const base = resolve(directory, name);
  for (const [path, content] of Object.entries(files)) {
    const output = resolve(base, path);
    await mkdir(resolve(output, '..'), { recursive: true });
    await writeFile(output, content, 'utf8');
  }
  await tar.c({ gzip: true, file: target, cwd: directory }, [name]);
}

function json(
  response: ServerResponse,
  status: number,
  value: unknown,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  response.end(JSON.stringify(value));
}

async function binary(response: ServerResponse, path: string): Promise<void> {
  response.writeHead(200, { 'content-type': 'application/octet-stream' });
  response.end(await readFile(path));
}
