import type { ApiErrorBody } from './api';

/** Error thrown for non-2xx API responses, carrying the server's message. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string | null = null,
    readonly fields: ApiErrorBody['fields'] = undefined,
  ) {
    super(message);
  }
}

/** Header the server requires on state-changing admin and setup requests (CSRF protection). */
export const CSRF_HEADERS = { 'x-agt-request': '1' };

/**
 * Fetches JSON from the app's own API. Event data is never cached on the
 * client: every request uses `cache: 'no-store'`.
 */
export async function apiRequest<T>(
  path: string,
  init: { method?: string; json?: unknown; body?: BodyInit; signal?: AbortSignal; csrf?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.json !== undefined) headers['Content-Type'] = 'application/json';
  if (init.csrf ?? (init.method !== undefined && init.method !== 'GET')) Object.assign(headers, CSRF_HEADERS);
  const response = await fetch(path, {
    method: init.method ?? 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    headers,
    signal: init.signal,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const body = (data ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(response.status, body.message ?? `HTTP ${response.status}`, body.error ?? null, body.fields);
  }
  return data as T;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
