/** Hub 请求失败时保留 HTTP 状态，便于页面给出可操作提示。 */
export class HubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function useHubApi() {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    const response = await fetch(`/api/v1${path}`, { ...init, headers });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const message = isErrorBody(body) ? body.message : `Hub 请求失败 (${response.status})`;
      throw new HubApiError(message, response.status);
    }
    return body as T;
  }

  return { request };
}

function isErrorBody(value: unknown): value is { message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof value.message === 'string'
  );
}
