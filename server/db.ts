import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import initialSchema from './migrations/0001_initial.sql';
import recordTimestamps from './migrations/0002_record_timestamps.sql';

export type Db = SqliteDatabase;

export interface Migration { version: number; name: string; sql: string }

/** Numbered plain-SQL migrations. Never edit a released migration; add a new one. */
export const MIGRATIONS: Migration[] = [
  { version: 1, name: '0001_initial', sql: initialSchema },
  { version: 2, name: '0002_record_timestamps', sql: recordTimestamps },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export const EXPECTED_TABLES = [
  'images', 'events', 'event_links', 'national_holidays', 'changelog',
  'settings', 'admin', 'sessions', 'app_secrets', 'altcha_used',
];

export function schemaVersion(db: Db): number {
  return db.pragma('user_version', { simple: true }) as number;
}

/** Called for every migration applied, so the server log can record it. */
export type OnMigration = (migration: Migration) => void;

/**
 * Runs pending migrations of `migrations` (default: the main database's), each
 * in its own transaction, and records the version in `PRAGMA user_version`.
 */
export function runMigrations(db: Db, onApplied?: OnMigration, migrations: Migration[] = MIGRATIONS, label = 'Database'): number {
  const current = schemaVersion(db);
  const latest = migrations[migrations.length - 1].version;
  if (current > latest) {
    throw new Error(`${label} schema version ${current} is newer than this application supports (${latest}).`);
  }
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.pragma(`user_version = ${migration.version}`);
    })();
    onApplied?.(migration);
  }
  return schemaVersion(db);
}

/** Opens a SQLite file with the standard pragmas (DATA-5). */
export function openSqlite(file: string, options: { readonly?: boolean } = {}): Db {
  if (!options.readonly) mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file, { readonly: options.readonly ?? false, fileMustExist: options.readonly ?? false });
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  if (!options.readonly) db.pragma('journal_mode = WAL');
  return db;
}

export function openDatabase(file: string, options: { readonly?: boolean; onMigration?: OnMigration } = {}): Db {
  const db = openSqlite(file, options);
  if (!options.readonly) {
    try {
      runMigrations(db, options.onMigration);
    } catch (error) {
      db.close();
      throw error;
    }
  }
  return db;
}

export function missingTables(db: Db): string[] {
  const present = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[])
      .map((row) => row.name),
  );
  return EXPECTED_TABLES.filter((table) => !present.has(table));
}
