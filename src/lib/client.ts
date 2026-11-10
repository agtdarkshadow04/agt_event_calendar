import type { ApiErrorBody } from './api';
import { withMaintenanceRetry } from './maintenance';

/**
 * Error thrown for non-2xx API responses: the `error` code, its `params` and field errors, and the server's English
 * message. Show it with `errorText()` / `fieldErrorText()` from `./errors` (I18N-6), never `message` directly.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string | null = null,
    readonly fields: ApiErrorBody['fields'] = undefined,
    readonly params: ApiErrorBody['params'] = undefined,
  ) {
    super(message);
  }
}

/** Header the server requires on state-changing admin and setup requests (CSRF protection). */
export const CSRF_HEADERS = { 'x-agt-request': '1' };

/**
 * Sent on every request so the audit log can tell the app's own UI from other
 * API clients. Informational only: the server never uses it for authorization.
 */
export const CLIENT_HEADERS = { 'x-agt-client': 'web' };

async function errorFrom(response: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> = {};
  try {
    body = JSON.parse(await response.text()) as Partial<ApiErrorBody>;
  } catch {
    body = {};
  }
  return new ApiError(response.status, body.message ?? `HTTP ${response.status}`, body.error ?? null, body.fields, body.params);
}

/**
 * Fetches JSON from the app's own API. Event data is never cached on the
 * client: every request uses `cache: 'no-store'`.
 */
export async function apiRequest<T>(
  path: string,
  init: { method?: string; json?: unknown; body?: BodyInit; signal?: AbortSignal; csrf?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...CLIENT_HEADERS };
  if (init.json !== undefined) headers['Content-Type'] = 'application/json';
  if (init.csrf ?? (init.method !== undefined && init.method !== 'GET')) Object.assign(headers, CSRF_HEADERS);
  // `503 maintenance` is retried once after Retry-After (FE-5); the request never reached its handler.
  const response = await withMaintenanceRetry(() => fetch(path, {
    method: init.method ?? 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    headers,
    signal: init.signal,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  }), init.signal);
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const body = (data ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(response.status, body.message ?? `HTTP ${response.status}`, body.error ?? null, body.fields, body.params);
  }
  return data as T;
}

/** The file name from a `Content-Disposition: attachment; filename="…"` header. */
export function attachmentFileName(header: string | null, fallback: string): string {
  const match = /filename="([^"]+)"/.exec(header ?? '');
  return match ? match[1] : fallback;
}

/** Downloads a file from the API (with the same headers as `apiRequest()`), returning its contents and name. */
export async function apiDownload(path: string, fallbackName: string): Promise<{ blob: Blob; fileName: string }> {
  const response = await withMaintenanceRetry(
    () => fetch(path, { cache: 'no-store', credentials: 'same-origin', headers: { ...CLIENT_HEADERS } }),
  );
  if (!response.ok) throw await errorFrom(response);
  return { blob: await response.blob(), fileName: attachmentFileName(response.headers.get('Content-Disposition'), fallbackName) };
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
