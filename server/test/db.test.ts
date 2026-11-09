import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { EXPECTED_TABLES, MIGRATIONS, SCHEMA_VERSION, missingTables, openDatabase, runMigrations, schemaVersion } from '../db';

const dir = mkdtempSync(path.join(tmpdir(), 'agt-db-test-'));
after(() => rmSync(dir, { recursive: true, force: true }));

describe('database migrations', () => {
  it('numbers migrations consecutively from 1', () => {
    assert.deepEqual(MIGRATIONS.map((migration) => migration.version), MIGRATIONS.map((_, index) => index + 1));
    assert.equal(SCHEMA_VERSION, MIGRATIONS.length);
  });

  it('creates the full schema on an empty database', () => {
    const db = openDatabase(path.join(dir, 'empty.sqlite'));
    try {
      assert.equal(schemaVersion(db), SCHEMA_VERSION);
      assert.deepEqual(missingTables(db), []);
      assert.ok(EXPECTED_TABLES.length > 0);
    } finally {
      db.close();
    }
  });

  it('upgrades a database from every released schema version, keeping its data', () => {
    for (let from = 1; from < SCHEMA_VERSION; from += 1) {
      const file = path.join(dir, `from-${from}.sqlite`);
      const db = new Database(file);
      try {
        for (const migration of MIGRATIONS.filter((candidate) => candidate.version <= from)) db.exec(migration.sql);
        db.pragma(`user_version = ${from}`);
        db.prepare(`INSERT INTO images (id, file_name, mime_type, size_bytes, sha256, created_at)
          VALUES ('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111.png', 'image/png', 1, 'x', '2024-01-01T00:00:00.000Z')`).run();
        db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('site.title', '"Kept"', '2024-02-02T00:00:00.000Z')`).run();
        db.prepare(`INSERT INTO app_secrets (name, value) VALUES ('altcha_hmac_key', 'secret')`).run();

        assert.equal(runMigrations(db), SCHEMA_VERSION);
        assert.deepEqual(missingTables(db), []);
        const image = db.prepare('SELECT created_at, updated_at FROM images').get() as { created_at: string; updated_at: string };
        assert.equal(image.updated_at, image.created_at);
        const setting = db.prepare('SELECT value, created_at, updated_at FROM settings').get() as Record<string, string>;
        assert.deepEqual(setting, { value: '"Kept"', created_at: '2024-02-02T00:00:00.000Z', updated_at: '2024-02-02T00:00:00.000Z' });
        const secret = db.prepare('SELECT value, created_at, updated_at FROM app_secrets').get() as Record<string, string>;
        assert.equal(secret.value, 'secret');
        assert.match(secret.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      } finally {
        db.close();
      }
    }
  });

  it('refuses a database newer than the application supports', () => {
    const db = new Database(path.join(dir, 'newer.sqlite'));
    try {
      db.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
      assert.throws(() => runMigrations(db), /newer than this application supports/);
    } finally {
      db.close();
    }
  });
});
