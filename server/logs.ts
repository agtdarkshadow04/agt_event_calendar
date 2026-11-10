/**
 * Log store (AGT web app spec §13): the server log (events the server caused
 * itself) and the audit log (events users caused), in a SQLite file separate
 * from the app's data so that backups and restores never touch them.
 *
 * All SQL for the log store lives here. Writes never throw: a failure to log
 * must not fail a request (LOG-3), so it is reported once to stdout instead.
 */
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import pino from 'pino';
import type { Level, Logger, StreamEntry } from 'pino';
import type { AppContext } from './context';
import { setting } from './context';
import { openSqlite, runMigrations } from './db';
import type { Db, Migration, OnMigration } from './db';
import initialLogSchema from './migrations/logs/0001_initial.sql';

/** Numbered plain-SQL migrations of the log store. Never edit a released one; add a new one. */
export const LOG_MIGRATIONS: Migration[] = [
  { version: 1, name: '0001_initial', sql: initialLogSchema },
];

export const LOG_SCHEMA_VERSION = LOG_MIGRATIONS[LOG_MIGRATIONS.length - 1].version;

/** Levels stored in the server log: info and above (LOG-5). */
export const SERVER_LOG_LEVELS = ['info', 'warn', 'error', 'fatal'] as const;
export type ServerLogLevel = (typeof SERVER_LOG_LEVELS)[number];
const LEVEL_VALUES: Record<ServerLogLevel, number> = { info: 30, warn: 40, error: 50, fatal: 60 };

export const AUDIT_OUTCOMES = ['success', 'denied', 'rate_limited', 'failure'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];
export const ACTOR_TYPES = ['admin', 'anonymous'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

/** Non-success audit entries with the same key within this window are coalesced (LOG-11). */
export const COALESCE_WINDOW_MS = 60_000;

export interface ServerLogEntry {
  id: string;
  at: string;
  level: ServerLogLevel;
  source: string;
  message: string;
  requestId: string | null;
  details: Record<string, unknown>;
}

export interface AuditEntry {
  id: string;
  at: string;
  lastAt: string;
  count: number;
  actorType: ActorType;
  actor: string | null;
  ipHash: string | null;
  client: 'web' | 'api';
  action: string;
  method: string;
  route: string;
  targetType: string | null;
  targetId: string | null;
  outcome: AuditOutcome;
  statusCode: number;
  requestId: string | null;
  details: Record<string, unknown>;
}

export type NewAuditEntry = Omit<AuditEntry, 'id' | 'at' | 'lastAt' | 'count'> & { at?: string };

export interface ServerLogFilters {
  /** Minimum level. */
  level?: ServerLogLevel;
  source?: string;
  from?: string;
  to?: string;
  q?: string;
}

export interface AuditLogFilters {
  actorType?: ActorType;
  action?: string;
  outcome?: AuditOutcome;
  targetType?: string;
  targetId?: string;
  from?: string;
  to?: string;
  q?: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface RetentionLimits {
  serverRetentionDays: number;
  serverMaxEntries: number;
  auditRetentionDays: number;
  auditMaxEntries: number;
}

export interface RetentionResult {
  server: { byAge: number; byCap: number };
  audit: { byAge: number; byCap: number };
}

// ------------------------------------------------------------------ helpers

/** Cursors are opaque to clients; internally they are the `seq` of the last entry on a page. */
export function encodeCursor(seq: number): string {
  return Buffer.from(String(seq)).toString('base64url');
}

export function decodeCursor(cursor: string): number | null {
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  return /^[1-9]\d{0,15}$/.test(text) ? Number(text) : null;
}

const escapeLike = (text: string) => `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

function expandIpv6(address: string): string[] {
  let text = address.toLowerCase();
  const dotted = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted[1].split('.').map(Number);
    text = `${text.slice(0, -dotted[1].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split('::');
  const first = head ? head.split(':') : [];
  const last = tail === undefined ? [] : tail ? tail.split(':') : [];
  const fill = tail === undefined ? [] : new Array<string>(Math.max(0, 8 - first.length - last.length)).fill('0');
  return [...first, ...fill, ...last].map((group) => parseInt(group || '0', 16).toString(16));
}

/**
 * The address that is hashed: IPv4-mapped IPv6 addresses become IPv4, and
 * IPv6 addresses are cut to their /64 prefix, because clients rotate
 * addresses inside their /64 (LOG-12).
 */
export function normalizeIp(ip: string): string {
  const address = ip.trim().replace(/%.*$/, '');
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mapped) return mapped[1];
  if (isIP(address) === 6) return `${expandIpv6(address).slice(0, 4).join(':')}::/64`;
  return address;
}

/** Spreadsheet formula characters that CSV cells must not start with (LOG-22). */
const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV cell: formulas are neutralized with a leading quote, then the cell is quoted if needed. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export const SERVER_LOG_COLUMNS = ['id', 'at', 'level', 'source', 'message', 'requestId', 'details'] as const;
export const AUDIT_LOG_COLUMNS = [
  'id', 'at', 'lastAt', 'count', 'actorType', 'actor', 'ipHash', 'client', 'action', 'method', 'route',
  'targetType', 'targetId', 'outcome', 'statusCode', 'requestId', 'details',
] as const;

/** Streams entries as JSON Lines or CSV, in chunks, without loading the whole log into memory. */
export function exportStream<T extends object>(entries: Iterable<T>, columns: readonly string[], format: 'jsonl' | 'csv'): Readable {
  function* lines(): Generator<string> {
    let chunk = format === 'csv' ? `${columns.join(',')}\r\n` : '';
    let rows = 0;
    for (const entry of entries) {
      const record = entry as Record<string, unknown>;
      chunk += format === 'csv'
        ? `${columns.map((column) => csvCell(record[column])).join(',')}\r\n`
        : `${JSON.stringify(entry)}\n`;
      rows += 1;
      if (rows % 500 === 0) {
        yield chunk;
        chunk = '';
      }
    }
    if (chunk) yield chunk;
  }
  return Readable.from(lines());
}

/** Export file name: `agt-event-calendar-<server|audit>-log-<timestamp>.<ext>` (LOG-22). */
export function exportFileName(kind: 'server' | 'audit', format: 'jsonl' | 'csv', now = new Date()): string {
  return `agt-event-calendar-${kind}-log-${now.toISOString().replace(/[:.]/g, '-')}.${format}`;
}

// ------------------------------------------------------------------ rows

interface ServerLogRow {
  seq: number;
  id: string;
  at: string;
  level: ServerLogLevel;
  source: string;
  message: string;
  request_id: string | null;
  details: string;
}

interface AuditLogRow {
  seq: number;
  id: string;
  at: string;
  last_at: string;
  count: number;
  actor_type: ActorType;
  actor: string | null;
  ip_hash: string | null;
  client: 'web' | 'api';
  action: string;
  method: string;
  route: string;
  target_type: string | null;
  target_id: string | null;
  outcome: AuditOutcome;
  status_code: number;
  request_id: string | null;
  details: string;
}

function parseDetails(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

const toServerEntry = (row: ServerLogRow): ServerLogEntry => ({
  id: row.id, at: row.at, level: row.level, source: row.source, message: row.message,
  requestId: row.request_id, details: parseDetails(row.details),
});

const toAuditEntry = (row: AuditLogRow): AuditEntry => ({
  id: row.id, at: row.at, lastAt: row.last_at, count: row.count, actorType: row.actor_type, actor: row.actor,
  ipHash: row.ip_hash, client: row.client, action: row.action, method: row.method, route: row.route,
  targetType: row.target_type, targetId: row.target_id, outcome: row.outcome, statusCode: row.status_code,
  requestId: row.request_id, details: parseDetails(row.details),
});

function serverWhere(filters: ServerLogFilters): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.level) { clauses.push('level_value >= ?'); params.push(LEVEL_VALUES[filters.level]); }
  if (filters.source) { clauses.push('source = ?'); params.push(filters.source); }
  if (filters.from) { clauses.push('at >= ?'); params.push(filters.from); }
  if (filters.to) { clauses.push('at <= ?'); params.push(filters.to); }
  if (filters.q) { clauses.push("message LIKE ? ESCAPE '\\'"); params.push(escapeLike(filters.q)); }
  return { sql: clauses.join(' AND '), params };
}

function auditWhere(filters: AuditLogFilters): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const equal = (column: string, value: string | undefined) => {
    if (value) { clauses.push(`${column} = ?`); params.push(value); }
  };
  equal('actor_type', filters.actorType);
  equal('action', filters.action);
  equal('outcome', filters.outcome);
  equal('target_type', filters.targetType);
  equal('target_id', filters.targetId);
  if (filters.from) { clauses.push('at >= ?'); params.push(filters.from); }
  if (filters.to) { clauses.push('at <= ?'); params.push(filters.to); }
  if (filters.q) {
    clauses.push("(actor LIKE ? ESCAPE '\\' OR action LIKE ? ESCAPE '\\' OR target_type LIKE ? ESCAPE '\\' OR target_id LIKE ? ESCAPE '\\' OR details LIKE ? ESCAPE '\\')");
    const pattern = escapeLike(filters.q);
    params.push(pattern, pattern, pattern, pattern, pattern);
  }
  return { sql: clauses.join(' AND '), params };
}

// ------------------------------------------------------------------ store

export class LogStore {
  private readonly ipKey: Buffer;
  private failureReported = false;

  constructor(readonly db: Db) {
    this.ipKey = Buffer.from(this.metaValue('ip_hash_key', () => randomBytes(32).toString('hex')), 'hex');
  }

  /** Opens (and migrates) the log store file with the same pragmas as the main database. */
  static open(file: string, onMigration?: OnMigration): LogStore {
    const db = openSqlite(file);
    try {
      runMigrations(db, onMigration, LOG_MIGRATIONS, 'Log store');
      return new LogStore(db);
    } catch (error) {
      db.close();
      throw error;
    }
  }

  close(): void {
    if (this.db.open) this.db.close();
  }

  private metaValue(key: string, create: () => string): string {
    const row = this.db.prepare('SELECT value FROM log_meta WHERE key = ?').get(key) as { value: string } | undefined;
    if (row) return row.value;
    const value = create();
    this.db.prepare('INSERT INTO log_meta (key, value) VALUES (?, ?)').run(key, value);
    return value;
  }

  /** Runs a write; on failure reports once to stdout (never into the server log) and carries on (LOG-3). */
  private safely(write: () => void): void {
    try {
      if (!this.db.open) throw new Error('the log store is closed');
      write();
    } catch (error) {
      if (this.failureReported) return;
      this.failureReported = true;
      // Deliberately not the logger, to avoid recursion.
      console.error(`Could not write to the log store (further failures are not reported): ${(error as Error).message}`);
    }
  }

  /** First 16 hex characters of HMAC-SHA256 over the normalized address (LOG-12). The raw IP is never stored. */
  ipHash(ip: string | undefined): string | null {
    if (!ip) return null;
    return createHmac('sha256', this.ipKey).update(normalizeIp(ip)).digest('hex').slice(0, 16);
  }

  // -------------------------------------------------------------- server log

  writeServer(entry: { level: ServerLogLevel; source: string; message: string; requestId?: string | null; details?: Record<string, unknown>; at?: string }): void {
    this.safely(() => {
      this.db.prepare(
        `INSERT INTO server_log (id, at, level, level_value, source, message, request_id, details)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(), entry.at ?? new Date().toISOString(), entry.level, LEVEL_VALUES[entry.level], entry.source,
        entry.message, entry.requestId ?? null, JSON.stringify(entry.details ?? {}),
      );
    });
  }

  private queryServer(filters: ServerLogFilters, limit: number, before: number | null): { items: ServerLogEntry[]; last: number | null } {
    const where = serverWhere(filters);
    const clauses = [where.sql, before !== null ? 'seq < ?' : ''].filter(Boolean);
    const rows = this.db.prepare(
      `SELECT * FROM server_log ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY seq DESC LIMIT ?`,
    ).all(...where.params, ...(before !== null ? [before] : []), limit + 1) as ServerLogRow[];
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    return { items: page.map(toServerEntry), last: more ? page[page.length - 1].seq : null };
  }

  /** Newest first, paged by an opaque cursor (API-8). */
  listServer(filters: ServerLogFilters, limit: number, cursor: number | null = null): Page<ServerLogEntry> {
    const { items, last } = this.queryServer(filters, limit, cursor);
    return { items, nextCursor: last === null ? null : encodeCursor(last) };
  }

  *iterateServer(filters: ServerLogFilters): Generator<ServerLogEntry> {
    let before: number | null = null;
    for (;;) {
      const { items, last } = this.queryServer(filters, 500, before);
      yield* items;
      if (last === null) return;
      before = last;
    }
  }

  /** Unseen `warn` and `error`/`fatal` entries since the last "seen" marker (LOG-21). */
  serverSummary(): { unseenWarnings: number; unseenErrors: number } {
    const seen = Number(this.metaValue('server_seen_seq', () => '0'));
    const row = this.db.prepare(
      `SELECT
         coalesce(sum(CASE WHEN level = 'warn' THEN 1 ELSE 0 END), 0) AS warnings,
         coalesce(sum(CASE WHEN level IN ('error', 'fatal') THEN 1 ELSE 0 END), 0) AS errors
       FROM server_log WHERE seq > ? AND level_value >= 40`,
    ).get(seen) as { warnings: number; errors: number };
    return { unseenWarnings: row.warnings, unseenErrors: row.errors };
  }

  /** Marks every server log entry written so far as seen. */
  markServerSeen(): void {
    const row = this.db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'server_log'").get() as { seq: number } | undefined;
    this.db.prepare(
      `INSERT INTO log_meta (key, value) VALUES ('server_seen_seq', ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    ).run(String(row?.seq ?? 0));
  }

  /** Deletes every server log entry (LOG-20). There is no equivalent for the audit log. */
  clearServer(): number {
    return this.db.prepare('DELETE FROM server_log').run().changes;
  }

  // -------------------------------------------------------------- audit log

  /** Writes an audit entry. Non-success entries are coalesced within 60 seconds (LOG-11). */
  writeAudit(entry: NewAuditEntry): void {
    this.safely(() => {
      const at = entry.at ?? new Date().toISOString();
      this.db.transaction(() => {
        if (entry.outcome !== 'success') {
          const since = new Date(Date.parse(at) - COALESCE_WINDOW_MS).toISOString();
          const existing = this.db.prepare(
            `SELECT seq FROM audit_log
             WHERE action = ? AND outcome = ? AND status_code = ? AND ip_hash IS ? AND last_at >= ?
             ORDER BY seq DESC LIMIT 1`,
          ).get(entry.action, entry.outcome, entry.statusCode, entry.ipHash, since) as { seq: number } | undefined;
          if (existing) {
            this.db.prepare('UPDATE audit_log SET count = count + 1, last_at = ? WHERE seq = ?').run(at, existing.seq);
            return;
          }
        }
        this.db.prepare(
          `INSERT INTO audit_log (id, at, last_at, count, actor_type, actor, ip_hash, client, action, method, route,
             target_type, target_id, outcome, status_code, request_id, details)
           VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          randomUUID(), at, at, entry.actorType, entry.actor, entry.ipHash, entry.client, entry.action, entry.method,
          entry.route, entry.targetType, entry.targetId, entry.outcome, entry.statusCode, entry.requestId,
          JSON.stringify(entry.details),
        );
      })();
    });
  }

  private queryAudit(filters: AuditLogFilters, limit: number, before: number | null): { items: AuditEntry[]; last: number | null } {
    const where = auditWhere(filters);
    const clauses = [where.sql, before !== null ? 'seq < ?' : ''].filter(Boolean);
    const rows = this.db.prepare(
      `SELECT * FROM audit_log ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY seq DESC LIMIT ?`,
    ).all(...where.params, ...(before !== null ? [before] : []), limit + 1) as AuditLogRow[];
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    return { items: page.map(toAuditEntry), last: more ? page[page.length - 1].seq : null };
  }

  listAudit(filters: AuditLogFilters, limit: number, cursor: number | null = null): Page<AuditEntry> {
    const { items, last } = this.queryAudit(filters, limit, cursor);
    return { items, nextCursor: last === null ? null : encodeCursor(last) };
  }

  *iterateAudit(filters: AuditLogFilters): Generator<AuditEntry> {
    let before: number | null = null;
    for (;;) {
      const { items, last } = this.queryAudit(filters, 500, before);
      yield* items;
      if (last === null) return;
      before = last;
    }
  }

  // -------------------------------------------------------------- retention

  /**
   * Deletes entries older than the retention periods, then the oldest entries
   * above the caps. For the audit log, the cap removes non-success entries
   * first and success entries only when none are left (LOG-15).
   */
  applyRetention(limits: RetentionLimits, now = Date.now()): RetentionResult {
    const cutoff = (days: number) => new Date(now - days * 86_400_000).toISOString();
    const count = (table: string) => (this.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
    return this.db.transaction((): RetentionResult => {
      const serverByAge = this.db.prepare('DELETE FROM server_log WHERE at < ?').run(cutoff(limits.serverRetentionDays)).changes;
      const serverExcess = Math.max(0, count('server_log') - limits.serverMaxEntries);
      const serverByCap = serverExcess === 0 ? 0 : this.db.prepare(
        'DELETE FROM server_log WHERE seq IN (SELECT seq FROM server_log ORDER BY seq LIMIT ?)',
      ).run(serverExcess).changes;

      const auditByAge = this.db.prepare('DELETE FROM audit_log WHERE at < ?').run(cutoff(limits.auditRetentionDays)).changes;
      let auditExcess = Math.max(0, count('audit_log') - limits.auditMaxEntries);
      let auditByCap = 0;
      if (auditExcess > 0) {
        const nonSuccess = this.db.prepare(
          "DELETE FROM audit_log WHERE seq IN (SELECT seq FROM audit_log WHERE outcome <> 'success' ORDER BY seq LIMIT ?)",
        ).run(auditExcess).changes;
        auditByCap += nonSuccess;
        auditExcess -= nonSuccess;
      }
      if (auditExcess > 0) {
        auditByCap += this.db.prepare(
          'DELETE FROM audit_log WHERE seq IN (SELECT seq FROM audit_log ORDER BY seq LIMIT ?)',
        ).run(auditExcess).changes;
      }
      return { server: { byAge: serverByAge, byCap: serverByCap }, audit: { byAge: auditByAge, byCap: auditByCap } };
    })();
  }

  // -------------------------------------------------------------- pino stream

  /** Stores one pino JSON line in the server log. Access logs and debug/trace lines are never stored. */
  writePinoLine(line: string): void {
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    const value = typeof record.level === 'number' ? record.level : 0;
    if (value < LEVEL_VALUES.info) return;
    const level: ServerLogLevel = value >= 60 ? 'fatal' : value >= 50 ? 'error' : value >= 40 ? 'warn' : 'info';
    const {
      level: _level, time, msg, reqId, source, err, pid: _pid, hostname: _hostname, req: _req, res: _res,
      responseTime: _responseTime, ...rest
    } = record;
    const details: Record<string, unknown> = { ...rest };
    let message = typeof msg === 'string' ? msg : '';
    if (err && typeof err === 'object') {
      // Only the error's name, message and stack (LOG-9).
      const error = err as { type?: unknown; name?: unknown; message?: unknown; stack?: unknown };
      details.error = { name: error.name ?? error.type ?? 'Error', message: error.message ?? '', stack: error.stack ?? null };
      if (!message || message === error.message) message = String(error.message ?? 'Error');
    }
    const requestId = typeof reqId === 'string' || typeof reqId === 'number' ? String(reqId) : null;
    this.writeServer({
      level,
      source: typeof source === 'string' && source ? source : requestId ? 'http' : 'server',
      message,
      requestId,
      details,
      at: typeof time === 'number' ? new Date(time).toISOString() : undefined,
    });
  }
}

/**
 * Creates the app's pino logger (LOG-5): stdout follows `server.logLevel`, and
 * the log store receives `info` and above whatever that level is. Pass the
 * result to Fastify as `loggerInstance`.
 */
export function createLogger(store: LogStore, stdoutLevel: string, stdout: NodeJS.WritableStream | null = process.stdout): Logger {
  const streams: StreamEntry[] = [{ level: 'info', stream: { write: (line: string) => store.writePinoLine(line) } }];
  const toStdout = stdout !== null && stdoutLevel !== 'silent';
  if (toStdout) streams.push({ level: stdoutLevel as Level, stream: stdout });
  const base = toStdout && pino.levels.values[stdoutLevel] < LEVEL_VALUES.info ? stdoutLevel : 'info';
  return pino({ level: base }, pino.multistream(streams));
}

/** Runs log retention with the current settings and records what it deleted (LOG-15). */
export function runRetention(context: AppContext, log: FastifyBaseLogger, now = Date.now()): RetentionResult | null {
  try {
    const result = context.logs.applyRetention({
      serverRetentionDays: setting(context, 'logs.serverRetentionDays'),
      serverMaxEntries: setting(context, 'logs.serverMaxEntries'),
      auditRetentionDays: setting(context, 'logs.auditRetentionDays'),
      auditMaxEntries: setting(context, 'logs.auditMaxEntries'),
    }, now);
    const deleted = result.server.byAge + result.server.byCap + result.audit.byAge + result.audit.byCap;
    if (deleted > 0) log.info({ source: 'retention', ...result }, `Log retention deleted ${deleted} entries.`);
    return result;
  } catch (error) {
    log.error({ source: 'retention', err: error }, 'Log retention failed.');
    return null;
  }
}

export const RETENTION_INTERVAL_MS = 60 * 60 * 1000;

/** Runs retention when the app is ready and then every hour, without keeping the process alive. */
export function scheduleRetention(app: FastifyInstance, context: AppContext): void {
  let timer: NodeJS.Timeout | null = null;
  app.addHook('onReady', async () => {
    runRetention(context, app.log);
    timer = setInterval(() => runRetention(context, app.log), RETENTION_INTERVAL_MS);
    timer.unref();
  });
  app.addHook('onClose', async () => {
    if (timer) clearInterval(timer);
  });
}
