import type { CapabilityType, GitLabSourceConfig } from '@nova-cbb/harness-contracts';
import { HarnessError } from '@nova-cbb/harness-shared';

/** 可注入的 Fetch 签名，用于确定性 Mock 和企业网络封装。 */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** 来源适配器只按 authRef 读取凭据，禁止持久化或枚举 Secret。 */
export interface SecretResolver {
  get(reference: string): Promise<string | undefined>;
}

/** GitLab Projects API 中同步所需的最小字段集合。 */
export interface GitLabProject {
  id: number;
  name: string;
  path: string;
  path_with_namespace: string;
  description: string | null;
  default_branch: string | null;
  archived: boolean;
  visibility: string;
  topics?: string[];
  last_activity_at: string;
  web_url: string;
}

/** Git Tag 与固定 Commit SHA。 */
export interface GitLabTag {
  name: string;
  target: string;
  commit?: { id: string; committed_date?: string };
}

/** 完成入口、Manifest、README、Tag 与维护人探测后的仓库发现结果。 */
export interface DiscoveredGitLabProject {
  capabilityType: Extract<CapabilityType, 'skill' | 'plugin'>;
  project: GitLabProject;
  manifestContent?: string;
  manifestPath?: string;
  entryPath: string;
  entryExists: boolean;
  defaultBranchCommitSha: string;
  tags: GitLabTag[];
  readmeSummary?: string;
  maintainers: Array<{ name: string; username: string }>;
}

interface GitLabGroup {
  id: number;
  full_path: string;
}

/**
 * GitLab v4 只读来源适配器。递归发现通过 include_subgroups + 分页完成，
 * 404 文件按“缺失待审核”处理，401/403/429/5xx 保留明确语义并执行有界退避。
 */
export class GitLabSource {
  readonly #config: GitLabSourceConfig;
  readonly #secrets: SecretResolver;
  readonly #fetch: FetchLike;

  constructor(options: { config: GitLabSourceConfig; secrets: SecretResolver; fetch?: FetchLike }) {
    this.#config = options.config;
    this.#secrets = options.secrets;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async ping(): Promise<{ sourceId: string; reachable: true; rootGroupId: number }> {
    const root = await this.#getGroup(this.#config.rootGroup);
    return { sourceId: this.#config.id, reachable: true, rootGroupId: root.id };
  }

  async discover(): Promise<DiscoveredGitLabProject[]> {
    const groups: Array<{
      type: 'skill' | 'plugin';
      path: string;
      entryPath: string;
    }> = [
      {
        type: 'skill',
        path: joinGitLabPath(this.#config.rootGroup, this.#config.skillGroupPath),
        entryPath: 'SKILL.md',
      },
      {
        type: 'plugin',
        path: joinGitLabPath(this.#config.rootGroup, this.#config.pluginGroupPath),
        entryPath: '.claude-plugin/plugin.json',
      },
    ];

    const discovered = new Map<number, DiscoveredGitLabProject>();
    for (const group of groups) {
      const target = await this.#getGroup(group.path);
      const projects = await this.#getAll<GitLabProject>(
        `/groups/${target.id}/projects`,
        new URLSearchParams({
          include_subgroups: String(this.#config.recursive),
          with_shared: String(this.#config.includeSharedProjects),
          archived: 'false',
          simple: 'true',
          order_by: 'id',
          sort: 'asc',
        }),
      );

      for (const project of projects) {
        if (project.archived || discovered.has(project.id) || !project.default_branch) continue;
        const [manifestContent, entryContent, readme, tags, defaultBranchCommitSha, maintainers] =
          await Promise.all([
            this.#getFile(project.id, this.#config.manifestPath, project.default_branch),
            this.#getFile(project.id, group.entryPath, project.default_branch),
            this.#getFile(project.id, 'README.md', project.default_branch),
            this.#getAll<GitLabTag>(
              `/projects/${project.id}/repository/tags`,
              new URLSearchParams({ order_by: 'updated', sort: 'desc' }),
            ),
            this.#getLatestCommit(project.id, project.default_branch),
            this.#getAll<{ name: string; username: string }>(
              `/projects/${project.id}/members/all`,
              new URLSearchParams({ min_access_level: '40' }),
            ),
          ]);

        const item: DiscoveredGitLabProject = {
          capabilityType: group.type,
          project,
          entryPath: group.entryPath,
          entryExists: entryContent !== undefined,
          defaultBranchCommitSha,
          tags,
          maintainers,
        };
        const readmeSummary = summarizeReadme(readme);
        if (readmeSummary) item.readmeSummary = readmeSummary;
        if (manifestContent !== undefined) {
          item.manifestContent = manifestContent;
          item.manifestPath = this.#config.manifestPath;
        }
        discovered.set(project.id, item);
      }
    }
    return [...discovered.values()];
  }

  async #getGroup(path: string): Promise<GitLabGroup> {
    return this.#requestJson<GitLabGroup>(`/groups/${encodeURIComponent(path)}`);
  }

  async #getFile(projectId: number, path: string, ref: string): Promise<string | undefined> {
    try {
      const file = await this.#requestJson<{ content: string; encoding: string }>(
        `/projects/${projectId}/repository/files/${encodeURIComponent(path)}`,
        new URLSearchParams({ ref }),
      );
      if (file.encoding !== 'base64') {
        throw new HarnessError({
          code: 'SOURCE_UNAVAILABLE',
          message: `Unsupported GitLab file encoding: ${file.encoding}`,
          details: { projectId, path },
        });
      }
      return Buffer.from(file.content, 'base64').toString('utf8');
    } catch (error) {
      if (error instanceof HarnessError && error.code === 'NOT_FOUND') return undefined;
      throw error;
    }
  }

  async #getLatestCommit(projectId: number, ref: string): Promise<string> {
    const commits = await this.#requestJson<Array<{ id: string }>>(
      `/projects/${projectId}/repository/commits`,
      new URLSearchParams({ ref_name: ref, per_page: '1' }),
    );
    const commit = commits[0]?.id;
    if (!commit) {
      throw new HarnessError({
        code: 'SOURCE_UNAVAILABLE',
        message: `GitLab project ${projectId} has no commit on ${ref}`,
      });
    }
    return commit;
  }

  async #getAll<T>(path: string, parameters: URLSearchParams): Promise<T[]> {
    const output: T[] = [];
    let page = 1;
    while (true) {
      const pageParameters = new URLSearchParams(parameters);
      pageParameters.set('page', String(page));
      pageParameters.set('per_page', '100');
      const response = await this.#request(path, pageParameters);
      const items = (await response.json()) as T[];
      output.push(...items);
      const nextPage = response.headers.get('x-next-page');
      if (nextPage) {
        page = Number(nextPage);
      } else if (items.length === 100) {
        page += 1;
      } else {
        break;
      }
    }
    return output;
  }

  async #requestJson<T>(path: string, parameters?: URLSearchParams): Promise<T> {
    const response = await this.#request(path, parameters);
    return (await response.json()) as T;
  }

  async #request(path: string, parameters?: URLSearchParams): Promise<Response> {
    const base = this.#config.baseUrl.replace(/\/$/, '');
    const apiPath = this.#config.apiPath.replace(/\/$/, '');
    const url = new URL(`${base}${apiPath}${path}`);
    if (parameters) url.search = parameters.toString();
    const token = this.#config.authRef ? await this.#secrets.get(this.#config.authRef) : undefined;

    for (let attempt = 0; attempt <= this.#config.http.retries; attempt += 1) {
      let response: Response;
      try {
        const headers = new Headers({ Accept: 'application/json' });
        if (token) headers.set('PRIVATE-TOKEN', token);
        response = await this.#fetch(url, {
          headers,
          signal: AbortSignal.timeout(this.#config.http.timeoutMs),
          redirect: 'error',
        });
      } catch (error) {
        if (attempt < this.#config.http.retries) {
          await delay(this.#config.http.retryBaseDelayMs * 2 ** attempt);
          continue;
        }
        throw new HarnessError({
          code: 'SOURCE_UNAVAILABLE',
          message: `GitLab source ${this.#config.id} is unavailable`,
          cause: error,
          retryable: true,
          details: { host: url.host },
        });
      }

      if (response.ok) return response;
      if (response.status === 401) {
        throw new HarnessError({ code: 'AUTH_INVALID', message: 'GitLab authentication failed' });
      }
      if (response.status === 403) {
        throw new HarnessError({
          code: 'PERMISSION_DENIED',
          message: 'GitLab token does not have the required read permission',
        });
      }
      if (response.status === 404) {
        throw new HarnessError({
          code: 'NOT_FOUND',
          message: `GitLab resource was not found: ${path}`,
        });
      }
      if (
        (response.status === 429 || response.status >= 500) &&
        attempt < this.#config.http.retries
      ) {
        await delay(readRetryDelay(response, this.#config.http.retryBaseDelayMs * 2 ** attempt));
        continue;
      }
      throw new HarnessError({
        code: 'SOURCE_UNAVAILABLE',
        message: `GitLab returned HTTP ${response.status}`,
        retryable: response.status === 429 || response.status >= 500,
        details: { status: response.status, path },
      });
    }
    throw new HarnessError({ code: 'INTERNAL_ERROR', message: 'Unreachable GitLab retry state' });
  }
}

function joinGitLabPath(left: string, right: string): string {
  return `${left.replace(/\/$/, '')}/${right.replace(/^\//, '')}`;
}

function readRetryDelay(response: Response, fallback: number): number {
  const retryAfter = response.headers.get('retry-after');
  if (!retryAfter) return fallback;
  const seconds = Number(retryAfter);
  return Number.isFinite(seconds) ? Math.min(seconds * 1_000, 30_000) : fallback;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** 提取 README 首段纯文本作为 Manifest 缺失时的描述，避免把完整文档灌入 Catalog。 */
function summarizeReadme(content: string | undefined): string | undefined {
  if (!content) return undefined;
  const paragraph = content
    .replace(/^---[\s\S]*?---\s*/m, '')
    .split(/\r?\n\s*\r?\n/)
    .map((value) =>
      value
        .replace(/^#+\s*/gm, '')
        .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
        .trim(),
    )
    .find((value) => value && !value.startsWith('!['));
  return paragraph?.slice(0, 2_000);
}
