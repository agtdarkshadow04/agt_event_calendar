/**
 * The operation lock and the data-write barrier (AGT web app spec BAK-8, BAK-9).
 *
 * One lock per process with the states `idle`, `backup`, `restore` and `restore_failed`. A **data write** is any
 * request or job that changes the main database or `uploads/`; session rows are not data. Every `/api/` route
 * declares `config: { writesData }` and every job declares it when registered; the barrier is applied from that
 * declaration, never from the HTTP method. Writing repository and upload functions call `assertDataWrite()`, which
 * throws unless the call runs inside `withDataWrite()` (or the operation owner's own writes), so an undeclared write
 * fails in tests instead of slipping past a backup.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance, RouteOptions } from 'fastify';
import { HttpError } from './http';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Whether the route changes the main database or `uploads/` (BAK-8). Every `/api/` route MUST declare it. */
    writesData?: boolean;
  }
}

export type OperationState = 'idle' | 'backup' | 'restore' | 'restore_failed';

/** How long entering `backup` or `restore` waits for work in progress, and a write waits for a backup. */
export const DRAIN_MS = 30_000;
export const WRITE_WAIT_MS = 30_000;
export const RETRY_AFTER_SECONDS = 10;

const writeScope = new AsyncLocalStorage<true>();

/** `503 maintenance`, sent with `Retry-After` (API-6). A function, not a subclass: `http.ts` and this module import each other. */
export function maintenanceError(): HttpError {
  return new HttpError(503, 'maintenance', 'Maintenance in progress. Try again in a moment.', undefined, { retryAfterSeconds: RETRY_AFTER_SECONDS });
}

/** Throws unless the caller runs inside `withDataWrite()` or an operation's own writes. */
export function assertDataWrite(what: string): void {
  if (writeScope.getStore() !== true) {
    throw new Error(`${what} writes data outside withDataWrite(): declare config.writesData on the route or job.`);
  }
}

/** Runs the operation owner's own writes (startup, a restore). They never wait for the lock: the owner holds it. */
export function asOperationOwner<T>(fn: () => T): T {
  return writeScope.run(true, fn);
}

export interface JobOptions {
  name: string;
  writesData: boolean;
}

const HEALTH_URL = '/api/health';

/**
 * Applies the lock to an app: checks that every `/api/` route declares `writesData`, runs the handlers of data-writing
 * routes inside `withDataWrite()`, counts every `/api/` request except health, and answers them with
 * `503 maintenance` during a restore. Register before any route.
 */
export function registerOperationLock(app: FastifyInstance, lock: OperationLock): void {
  app.addHook('onRoute', (route: RouteOptions) => {
    if (!route.url.startsWith('/api/')) return;
    const writesData = route.config?.writesData;
    if (typeof writesData !== 'boolean') {
      throw new Error(`${String(route.method)} ${route.url} must declare config.writesData (BAK-8).`);
    }
    if (writesData) {
      const handler = route.handler;
      route.handler = function writesDataHandler(this: FastifyInstance, request, reply) {
        return lock.withDataWrite(() => handler.call(this, request, reply));
      };
    }
  });

  const releases = new WeakMap<object, () => void>();
  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/api/') || request.routeOptions.url === HEALTH_URL) return;
    if (lock.maintenance) throw maintenanceError();
    releases.set(request, lock.enterActivity());
  });
  const release = async (request: object) => {
    releases.get(request)?.();
  };
  app.addHook('onResponse', release);
  app.addHook('onRequestAbort', release);
}

export class OperationLock {
  state: OperationState = 'idle';
  /** Overridable for tests (TEST-4: "use an injectable clock or a shorter test limit"). */
  drainMs = DRAIN_MS;
  writeWaitMs = WRITE_WAIT_MS;
  /** Test hook, awaited once an operation has drained and before it does its work. */
  afterDrain: ((state: 'backup' | 'restore') => Promise<void>) | null = null;

  private writes = 0;
  private activity = 0;
  private readonly listeners = new Set<() => void>();

  /** True in `restore` and `restore_failed`: every `/api/` request except health gets `503 maintenance`. */
  get maintenance(): boolean {
    return this.state === 'restore' || this.state === 'restore_failed';
  }

  get dataWritesInProgress(): number {
    return this.writes;
  }

  get activityInProgress(): number {
    return this.activity;
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  /** Resolves true as soon as `condition` holds, or with its value after `ms`. */
  private waitFor(condition: () => boolean, ms: number): Promise<boolean> {
    if (condition()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (value: boolean) => {
        clearTimeout(timer);
        this.listeners.delete(check);
        resolve(value);
      };
      const check = () => { if (condition()) done(true); };
      const timer = setTimeout(() => done(condition()), ms);
      this.listeners.add(check);
    });
  }

  /**
   * Runs a data write. During a backup it waits for the lock to return to `idle` for up to `writeWaitMs`, then
   * gets `503 maintenance`; during a restore it gets `503` at once.
   */
  async withDataWrite<T>(fn: () => T | Promise<T>): Promise<T> {
    const deadline = Date.now() + this.writeWaitMs;
    while (this.state === 'backup') {
      const remaining = deadline - Date.now();
      if (remaining <= 0 || !(await this.waitFor(() => this.state !== 'backup', remaining))) throw maintenanceError();
    }
    if (this.state !== 'idle') throw maintenanceError();
    // Checked and counted in the same tick, so a backup that starts later always sees this write.
    this.writes += 1;
    try {
      return await writeScope.run(true, fn);
    } finally {
      this.writes -= 1;
      this.notify();
    }
  }

  /** Counts an `/api/` request (except health) or a job in progress. Returns the idempotent release function. */
  enterActivity(): () => void {
    this.activity += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activity -= 1;
      this.notify();
    };
  }

  /** Runs a background job: paused (skipped) during a restore, counted, and a data write if it declares one. */
  async runJob<T>(options: JobOptions, fn: () => T | Promise<T>): Promise<T | undefined> {
    if (this.maintenance) return undefined;
    const release = this.enterActivity();
    try {
      return options.writesData ? await this.withDataWrite(fn) : await fn();
    } finally {
      release();
    }
  }

  /**
   * Runs a backup or restore under the lock. It starts only from `idle` (else `409 conflict`), then drains: a backup
   * waits for the data writes in progress, a restore for every request and job except its own `ownActivity`. If the
   * drain is not done after `drainMs`, the lock returns to `idle` with nothing changed and the caller gets `409`.
   */
  async run<T>(state: 'backup' | 'restore', fn: () => Promise<T>, options: { ownActivity?: number } = {}): Promise<T> {
    if (this.state !== 'idle') throw new HttpError(409, 'conflict', 'A backup or restore is already running.');
    this.state = state;
    this.notify();
    try {
      const own = options.ownActivity ?? 0;
      const drained = await this.waitFor(
        () => (state === 'backup' ? this.writes === 0 : this.activity <= own && this.writes === 0),
        this.drainMs,
      );
      if (!drained) throw new HttpError(409, 'conflict', 'The server is busy. Try again.');
      if (this.afterDrain) await this.afterDrain(state);
      return await fn();
    } finally {
      this.state = 'idle';
      this.notify();
    }
  }
}
