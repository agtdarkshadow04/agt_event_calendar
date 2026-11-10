/**
 * `503 maintenance` handling shared by every API call (AGT web app spec BAK-8, FE-5). The server sends it while a
 * restore runs, or when a write waited too long for a backup. The client shows a non-blocking notice, waits for
 * `Retry-After` and retries the request once; it never treats it as a sign-out.
 */

export const DEFAULT_RETRY_AFTER_SECONDS = 10;
/** Never wait longer than this, whatever the server says. */
export const MAX_RETRY_AFTER_SECONDS = 60;

type Listener = (active: boolean) => void;
const listeners = new Set<Listener>();
let active = false;

export function isMaintenanceActive(): boolean {
  return active;
}

export function setMaintenanceActive(value: boolean): void {
  if (active === value) return;
  active = value;
  for (const listener of [...listeners]) listener(value);
}

export function subscribeMaintenance(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Seconds to wait before the retry: the `Retry-After` header, else `params.retryAfterSeconds`, clamped to 1–60. */
export function retryAfterSeconds(header: string | null, params: unknown): number {
  const fromHeader = header !== null && /^\d+$/.test(header.trim()) ? Number(header.trim()) : null;
  const fromParams = typeof params === 'object' && params !== null
    ? (params as Record<string, unknown>).retryAfterSeconds : undefined;
  const seconds = fromHeader ?? (typeof fromParams === 'number' && Number.isFinite(fromParams) ? fromParams : DEFAULT_RETRY_AFTER_SECONDS);
  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, Math.round(seconds)));
}

/** Waits `ms`, or rejects with an `AbortError` when the signal aborts. Replaceable in tests. */
export const timing = {
  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });
  },
};

async function maintenanceParams(response: Response): Promise<{ maintenance: boolean; params?: unknown }> {
  if (response.status !== 503) return { maintenance: false };
  try {
    const body = await response.clone().json() as { error?: unknown; params?: unknown };
    return { maintenance: body.error === 'maintenance', params: body.params };
  } catch {
    return { maintenance: false };
  }
}

/**
 * Sends a request; on `503 maintenance` shows the notice, waits for `Retry-After` and sends it once more. The notice
 * clears with the next API response that is not `503 maintenance`.
 */
export async function withMaintenanceRetry(send: () => Promise<Response>, signal?: AbortSignal): Promise<Response> {
  const first = await send();
  const check = await maintenanceParams(first);
  if (!check.maintenance) {
    setMaintenanceActive(false);
    return first;
  }
  setMaintenanceActive(true);
  await timing.sleep(retryAfterSeconds(first.headers.get('Retry-After'), check.params) * 1000, signal);
  const second = await send();
  if (!(await maintenanceParams(second)).maintenance) setMaintenanceActive(false);
  return second;
}
