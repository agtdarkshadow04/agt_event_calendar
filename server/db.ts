import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import initialSchema from './migrations/0001_initial.sql';

export type Db = SqliteDatabase;

/** Numbered plain-SQL migrations. Never edit a released migration; add a new one. */
export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  { version: 1, name: '0001_initial', sql: initialSchema },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export const EXPECTED_TABLES = [
  'images', 'events', 'event_links', 'national_holidays', 'changelog',
  'settings', 'admin', 'sessions', 'app_secrets', 'altcha_used',
];

export function schemaVersion(db: Db): number {
  return db.pragma('user_version', { simple: true }) as number;
}

/** Runs pending migrations, each in its own transaction, and records the version. */
export function runMigrations(db: Db): number {
  const current = schemaVersion(db);
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${current} is newer than this application supports (${SCHEMA_VERSION}).`,
    );
  }
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.pragma(`user_version = ${migration.version}`);
    })();
  }
  return schemaVersion(db);
}

export function openDatabase(file: string, options: { readonly?: boolean } = {}): Db {
  if (!options.readonly) mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file, { readonly: options.readonly ?? false, fileMustExist: options.readonly ?? false });
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  if (!options.readonly) {
    db.pragma('journal_mode = WAL');
    runMigrations(db);
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
