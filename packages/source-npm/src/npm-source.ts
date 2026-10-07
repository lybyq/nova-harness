import type { Capability, NpmSourceConfig } from '@nova-cbb/harness-contracts';
import { checksumOf, HarnessError } from '@nova-cbb/harness-shared';

/** 可注入的 Fetch 签名，用于 Mock Registry 与网络策略测试。 */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** npm Adapter 的最小 Secret 读取接口。 */
export interface SecretResolver {
  get(reference: string): Promise<string | undefined>;
}

interface NpmSearchResponse {
  objects: Array<{ package: { name: string } }>;
  total: number;
}

interface PackumentVersion {
  name: string;
  version: string;
  description?: string;
  dist: { tarball: string; integrity?: string; shasum?: string };
  bin?: string | Record<string, string>;
  dependencies?: Record<string, string>;
  novaHarness?: Record<string, unknown>;
  [key: string]: unknown;
}

interface Packument {
  name: string;
  description?: string;
  maintainers?: Array<{ name?: string; username?: string; email?: string }>;
  'dist-tags': Record<string, string>;
  versions: Record<string, PackumentVersion>;
}

/** npm Packument 与转换后的统一 Capability。 */
export interface DiscoveredNpmPackage {
  name: string;
  packument: Packument;
  capability: Capability;
}

/**
 * 私有 npm 发现适配器，支持标准 Search API、静态索引、seedPackages、Scope 和 glob 过滤。
 * 元数据与 tarball 主机由后续下载白名单再次校验，Token 只进入 Authorization Header。
 */
export class NpmSource {
  readonly #config: NpmSourceConfig;
  readonly #secrets: SecretResolver;
  readonly #fetch: FetchLike;

  constructor(options: { config: NpmSourceConfig; secrets: SecretResolver; fetch?: FetchLike }) {
    this.#config = options.config;
    this.#secrets = options.secrets;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async ping(): Promise<{ sourceId: string; reachable: true }> {
    await this.#requestJson<unknown>('/-/ping?write=false');
    return { sourceId: this.#config.id, reachable: true };
  }

  async discover(): Promise<DiscoveredNpmPackage[]> {
    const names = await this.#discoverNames();
    const discovered: DiscoveredNpmPackage[] = [];
    for (const name of names) {
      const packument = await this.#requestJson<Packument>(`/${encodePackageName(name)}`, {
        Accept: 'application/vnd.npm.install-v1+json, application/json;q=0.8',
      });
      discovered.push({ name, packument, capability: toCapability(this.#config, packument) });
    }
    return discovered;
  }

  async #discoverNames(): Promise<string[]> {
    const names = new Set(this.#config.seedPackages);
    const adapter =
      this.#config.adapter === 'auto' ? inferAdapter(this.#config) : this.#config.adapter;

    if (this.#config.staticIndexUrl) {
      const index = await this.#requestAbsoluteJson<{ packages: string[] }>(
        this.#config.staticIndexUrl,
      );
      for (const name of index.packages) names.add(name);
    }

    if (adapter === 'static-index') return filterNames(names, this.#config.packagePatterns);
    if (adapter !== 'npm-compatible') {
      throw new HarnessError({
        code: 'CONFIG_INVALID',
        message: `Registry adapter ${adapter} requires its provider-specific endpoint configuration`,
      });
    }

    for (const scope of this.#config.scopes.length > 0 ? this.#config.scopes : ['']) {
      let offset = 0;
      while (true) {
        const search = new URLSearchParams({ text: scope, size: '250', from: String(offset) });
        const page = await this.#requestJson<NpmSearchResponse>(
          `/-/v1/search?${search.toString()}`,
        );
        for (const item of page.objects) names.add(item.package.name);
        offset += page.objects.length;
        if (page.objects.length === 0 || offset >= page.total) break;
      }
    }
    return filterNames(names, this.#config.packagePatterns);
  }

  async #requestJson<T>(path: string, headers?: Record<string, string>): Promise<T> {
    const registry = this.#config.registry.replace(/\/$/, '');
    return this.#requestAbsoluteJson<T>(`${registry}${path}`, headers);
  }

  async #requestAbsoluteJson<T>(urlValue: string, headers?: Record<string, string>): Promise<T> {
    const url = new URL(urlValue);
    const registryHost = new URL(this.#config.registry).host;
    if (url.host !== registryHost) {
      throw new HarnessError({
        code: 'UNTRUSTED_SOURCE',
        message: `npm metadata endpoint host is not trusted: ${url.host}`,
      });
    }
    const token = this.#config.authRef ? await this.#secrets.get(this.#config.authRef) : undefined;

    for (let attempt = 0; attempt <= this.#config.http.retries; attempt += 1) {
      let response: Response;
      try {
        const requestHeaders = new Headers({ Accept: 'application/json', ...headers });
        if (token) requestHeaders.set('Authorization', `Bearer ${token}`);
        response = await this.#fetch(url, {
          headers: requestHeaders,
          redirect: 'error',
          signal: AbortSignal.timeout(this.#config.http.timeoutMs),
        });
      } catch (error) {
        if (attempt < this.#config.http.retries) {
          await delay(this.#config.http.retryBaseDelayMs * 2 ** attempt);
          continue;
        }
        throw new HarnessError({
          code: 'SOURCE_UNAVAILABLE',
          message: `npm source ${this.#config.id} is unavailable`,
          cause: error,
          retryable: true,
          details: { host: url.host },
        });
      }

      if (response.ok) return (await response.json()) as T;
      if (response.status === 401) {
        throw new HarnessError({ code: 'AUTH_INVALID', message: 'npm authentication failed' });
      }
      if (response.status === 403) {
        throw new HarnessError({
          code: 'PERMISSION_DENIED',
          message: 'npm token does not have the required read permission',
        });
      }
      if (response.status === 404) {
        throw new HarnessError({
          code: 'NOT_FOUND',
          message: `npm resource not found: ${url.pathname}`,
        });
      }
      if (
        (response.status === 429 || response.status >= 500) &&
        attempt < this.#config.http.retries
      ) {
        await delay(this.#config.http.retryBaseDelayMs * 2 ** attempt);
        continue;
      }
      throw new HarnessError({
        code: 'SOURCE_UNAVAILABLE',
        message: `npm registry returned HTTP ${response.status}`,
        retryable: response.status === 429 || response.status >= 500,
      });
    }
    throw new HarnessError({ code: 'INTERNAL_ERROR', message: 'Unreachable npm retry state' });
  }
}

function inferAdapter(config: NpmSourceConfig): 'static-index' | 'npm-compatible' {
  return config.staticIndexUrl || config.seedPackages.length > 0
    ? 'static-index'
    : 'npm-compatible';
}

function encodePackageName(name: string): string {
  return name.startsWith('@') ? name.replace('/', '%2f') : encodeURIComponent(name);
}

function filterNames(names: Iterable<string>, patterns: string[]): string[] {
  const matchers = patterns.map(globMatcher);
  return [...names]
    .filter((name) => matchers.length === 0 || matchers.some((matcher) => matcher.test(name)))
    .sort();
}

function globMatcher(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`);
}

function toCapability(config: NpmSourceConfig, packument: Packument): Capability {
  const latestVersion = packument['dist-tags'].latest;
  if (!latestVersion) {
    throw new HarnessError({
      code: 'SOURCE_UNAVAILABLE',
      message: `${packument.name} does not define a latest dist-tag`,
    });
  }
  const latest = packument.versions[latestVersion];
  if (!latest) {
    throw new HarnessError({
      code: 'SOURCE_UNAVAILABLE',
      message: `${packument.name} has an invalid latest dist-tag`,
    });
  }
  const manifest = latest[config.manifestField];
  const metadata = isRecord(manifest) ? manifest : {};
  const id = typeof metadata.id === 'string' ? metadata.id : safeCapabilityId(packument.name);
  const displayName =
    typeof metadata.displayName === 'string' ? metadata.displayName : packument.name;
  const description =
    typeof metadata.description === 'string'
      ? metadata.description
      : (latest.description ?? packument.description ?? '');

  return {
    id,
    type: 'mcp',
    name: packument.name,
    displayName,
    description,
    tags: stringArray(metadata.tags),
    categories: stringArray(metadata.categories),
    maintainers: (packument.maintainers ?? []).map((maintainer) => ({
      ...(maintainer.name || maintainer.username
        ? { name: maintainer.name ?? maintainer.username }
        : {}),
      ...(maintainer.email ? { email: maintainer.email } : {}),
    })),
    status: isRecord(manifest) ? 'active' : 'needs-review',
    riskLevel: 'medium',
    source: {
      sourceId: config.id,
      kind: 'npm',
      locator: packument.name,
      packageName: packument.name,
    },
    versions: Object.values(packument.versions).map((item) => ({
      version: item.version,
      recommended: item.version === latestVersion,
      ...(item.dist.integrity ? { integrity: item.dist.integrity } : {}),
      artifact: { kind: 'npm-tarball' as const, url: item.dist.tarball },
      manifestChecksum: checksumOf(item[config.manifestField] ?? {}),
      dependencies: [],
      conflicts: [],
      runtimeBindings: {},
    })),
    secrets: [],
    configuration: [],
    sourceMetadata: {
      distTags: packument['dist-tags'],
      bin: latest.bin ?? {},
      tarballHost: new URL(latest.dist.tarball).host,
    },
    adminOverrides: {},
  };
}

function safeCapabilityId(name: string): string {
  return name
    .replace(/^@[^/]+\//, '')
    .replace(/-mcp$/, '')
    .replace(/[^a-z0-9._-]/g, '-');
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
