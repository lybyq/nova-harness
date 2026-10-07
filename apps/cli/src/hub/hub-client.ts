import type { DeploymentProfile } from '@nova-cbb/harness-contracts';
import { HarnessError } from '@nova-cbb/harness-shared';
import type { EnvironmentSecrets } from '../config/environment-secrets.js';

/**
 * Hub HTTP 客户端。统一处理超时、Bearer Secret 引用和领域错误，
 * 错误详情经过 Output Redactor 后才允许显示，URL 中永不拼接 Token。
 */
export class HubClient {
  constructor(
    private readonly profile: DeploymentProfile,
    private readonly secrets: EnvironmentSecrets,
  ) {}

  health(): Promise<unknown> {
    return this.request('/health', { authenticated: false });
  }

  catalog<T = unknown>(parameters: URLSearchParams): Promise<T> {
    return this.request<T>(`/catalog?${parameters.toString()}`);
  }

  capability<T = unknown>(id: string): Promise<T> {
    return this.request<T>(`/capabilities/${encodeURIComponent(id)}`);
  }

  roles<T = unknown>(): Promise<T> {
    return this.request<T>('/roles');
  }
  role<T = unknown>(id: string): Promise<T> {
    return this.request<T>(`/roles/${encodeURIComponent(id)}`);
  }
  resolve<T = unknown>(input: unknown): Promise<T> {
    return this.request<T>('/resolve', { method: 'POST', body: input });
  }
  /** 保存新角色草稿。 */
  createRole<T = unknown>(document: unknown): Promise<T> {
    return this.request<T>('/roles', { method: 'POST', body: document });
  }
  /** 更新指定角色草稿。 */
  updateRole<T = unknown>(id: string, document: unknown): Promise<T> {
    return this.request<T>(`/roles/${encodeURIComponent(id)}`, { method: 'PUT', body: document });
  }
  /** 在 Hub 侧校验角色及 Catalog 映射。 */
  validateRole<T = unknown>(id: string, document?: unknown): Promise<T> {
    return this.request<T>(`/roles/${encodeURIComponent(id)}/validate`, {
      method: 'POST',
      ...(document === undefined ? {} : { body: document }),
    });
  }
  /** 发布角色最新版本。 */
  publishRole<T = unknown>(id: string): Promise<T> {
    return this.request<T>(`/roles/${encodeURIComponent(id)}/publish`, { method: 'POST' });
  }
  /** 查询能力的所有版本。 */
  versions<T = unknown>(id: string): Promise<T> {
    return this.request<T>(`/capabilities/${encodeURIComponent(id)}/versions`);
  }
  /** 查询能力依赖。 */
  dependencies<T = unknown>(id: string): Promise<T> {
    return this.request<T>(`/capabilities/${encodeURIComponent(id)}/dependencies`);
  }
  /** 查询 Runtime 兼容性。 */
  compatibility<T = unknown>(id: string): Promise<T> {
    return this.request<T>(`/capabilities/${encodeURIComponent(id)}/compatibility`);
  }

  sync(type?: 'gitlab' | 'npm'): Promise<unknown> {
    return this.request(`/sync${type ? `/${type}` : ''}`, { method: 'POST' });
  }

  private async request<T = unknown>(
    path: string,
    options: { method?: 'GET' | 'POST' | 'PUT'; authenticated?: boolean; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(`${this.profile.hub.url.replace(/\/$/, '')}${path}`);
    const headers = new Headers({ Accept: 'application/json' });
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    if (options.authenticated !== false && this.profile.hub.authRef) {
      const token = await this.secrets.get(this.profile.hub.authRef);
      if (!token) {
        throw new HarnessError({
          code: 'AUTH_REQUIRED',
          message: `缺少 Hub Secret：${this.profile.hub.authRef}`,
        });
      }
      headers.set('Authorization', `Bearer ${token}`);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? 'GET',
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: AbortSignal.timeout(this.profile.hub.http.timeoutMs),
        redirect: 'error',
      });
    } catch (error) {
      throw new HarnessError({
        code: 'SOURCE_UNAVAILABLE',
        message: `无法连接 Nova Hub：${url.origin}`,
        hint: '确认 Hub 已启动，或检查 Deployment Profile 中的 hub.url。',
        cause: error,
        retryable: true,
      });
    }
    const body = await readBody(response);
    if (response.ok) return body as T;
    if (response.status === 401) {
      throw new HarnessError({ code: 'AUTH_INVALID', message: 'Hub Token 无效或已过期' });
    }
    throw new HarnessError({
      code: 'SOURCE_UNAVAILABLE',
      message: `Hub 返回 HTTP ${response.status}`,
      details: { response: body },
    });
  }
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
