import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { SCHEMA_VERSION } from '../db';
import { getSecret } from '../repository';
import { openSafeZip } from '../zip';
import { CSRF, JPEG, createTestServer, makeZip, multipart, setupAdmin, validEvent } from './helpers';
import type { TestServer } from './helpers';

const CONFIG = 'site:\n  title: Configured Title\n';
const servers: TestServer[] = [];
after(async () => { for (const server of servers) await server.close(); });

async function adminServer(config = CONFIG) {
  const server = await createTestServer({ config });
  servers.push(server);
  let headers = { cookie: await setupAdmin(server), ...CSRF };
  const restore = (zip: Buffer, action: 'preview' | 'restore') => {
    const body = multipart({ action }, [{ name: 'backup', fileName: 'backup.zip', contentType: 'application/zip', data: zip }]);
    return server.app.inject({ method: 'POST', url: '/api/admin/restore', payload: body.payload, headers: { ...headers, ...body.headers } });
  };
  const relogin = async () => {
    const response = await server.app.inject({
      method: 'POST', url: '/api/admin/login', headers: CSRF, payload: { username: 'admin', password: 'correct horse battery staple' },
    });
    headers = { cookie: String(response.headers['set-cookie']).split(';')[0], ...CSRF };
    return headers;
  };
  return { ...server, get headers() { return headers; }, restore, relogin };
}

async function readZip(dir: string, data: Buffer): Promise<Map<string, Buffer>> {
  const file = path.join(dir, `${Math.random()}.zip`);
  writeFileSync(file, data);
  const zip = await openSafeZip(file, { maxEntries: 1000, maxUncompressedBytes: 1e9 });
  const out = new Map<string, Buffer>();
  for (const entry of zip.entries) if (!entry.isDirectory) out.set(entry.name, await zip.read(entry));
  zip.close();
  return out;
}

async function seed(test: Awaited<ReturnType<typeof adminServer>>) {
  const body = multipart({}, [{ name: 'file', fileName: 'c.jpg', contentType: 'image/jpeg', data: JPEG }]);
  const image = (await test.app.inject({ method: 'POST', url: '/api/admin/images', payload: body.payload, headers: { ...test.headers, ...body.headers } })).json().image;
  await test.app.inject({ method: 'POST', url: '/api/admin/events', headers: test.headers, payload: { ...validEvent, status: 'published', coverImageId: image.id } });
  await test.app.inject({ method: 'PUT', url: '/api/admin/settings', headers: test.headers, payload: { values: { 'submissions.enabled': false } } });
}

async function exportBackup(test: Awaited<ReturnType<typeof adminServer>>) {
  const response = await test.app.inject({ method: 'GET', url: '/api/admin/backup', headers: test.headers });
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers['content-disposition']), /attachment; filename="agt-event-calendar-backup-.*\.zip"/);
  return response.rawPayload;
}

function rezip(dir: string, files: Map<string, Buffer>, options: { keepManifest?: boolean } = {}) {
  const entries = [...files].filter(([name]) => name !== 'manifest.json');
  const manifest = JSON.parse(files.get('manifest.json')!.toString());
  if (!options.keepManifest) {
    manifest.files = entries.map(([name, data]) => ({ path: name, size: data.length, sha256: createHash('sha256').update(data).digest('hex') }));
  }
  return makeZip(dir, `${Math.random()}.zip`, [{ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) }, ...entries.map(([name, data]) => ({ name, data }))]);
}

describe('backup export', () => {
  it('contains a consistent DB snapshot, uploads, config.yaml and a checksummed manifest, but never .env', async () => {
    const test = await adminServer();
    writeFileSync(path.join(test.dir, '.env'), 'AGT_SETUP_PASSWORD=secret');
    await seed(test);
    const files = await readZip(test.dir, await exportBackup(test));
    const names = [...files.keys()].sort();
    assert.equal(names.length, 4);
    assert.deepEqual(names.filter((name) => !name.startsWith('uploads/')), ['config.yaml', 'database.sqlite', 'manifest.json']);
    assert.equal(names.some((name) => name.includes('.env')), false);
    assert.equal(files.get('config.yaml')!.toString(), CONFIG);

    const manifest = JSON.parse(files.get('manifest.json')!.toString());
    assert.equal(manifest.schemaVersion, SCHEMA_VERSION);
    assert.equal(manifest.appVersion, 'test');
    assert.ok(Date.parse(manifest.createdAt));
    for (const file of manifest.files) {
      assert.equal(createHash('sha256').update(files.get(file.path)!).digest('hex'), file.sha256);
    }

    const dbFile = path.join(test.dir, 'snapshot.sqlite');
    writeFileSync(dbFile, files.get('database.sqlite')!);
    const snapshot = new Database(dbFile, { readonly: true });
    assert.equal(snapshot.pragma('integrity_check', { simple: true }), 'ok');
    assert.equal((snapshot.prepare('SELECT count(*) AS n FROM events').get() as { n: number }).n, 1);
    assert.equal((snapshot.prepare('SELECT count(*) AS n FROM sessions').get() as { n: number }).n, 0);
    snapshot.close();
  });
});

describe('backup restore', () => {
  it('generates the ALTCHA key at the end of a restore whose data has none (ALT-2)', async () => {
    const test = await adminServer();
    test.context.db.prepare(`DELETE FROM app_secrets WHERE name = 'altcha_hmac_key'`).run();
    const backup = await exportBackup(test);
    const response = await test.restore(backup, 'restore');
    assert.equal(response.statusCode, 200, response.body);
    assert.match(getSecret(test.context.db, 'altcha_hmac_key') ?? '', /^[0-9a-f]{64}$/);
    assert.equal((await test.app.inject({ method: 'GET', url: '/api/altcha/challenge' })).statusCode, 200);
  });

  it('restores the database, uploads and settings after a pre-restore backup, and ends the session', async () => {
    const test = await adminServer();
    await seed(test);
    const backup = await exportBackup(test);

    await test.app.inject({ method: 'POST', url: '/api/admin/events', headers: test.headers, payload: { ...validEvent, name: 'After backup' } });
    await test.app.inject({ method: 'PUT', url: '/api/admin/settings', headers: test.headers, payload: { values: { 'submissions.enabled': true } } });
    await test.app.inject({ method: 'POST', url: '/api/admin/images/cleanup', headers: test.headers });

    const preview = await test.restore(backup, 'preview');
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal(preview.json().counts.events, 1);
    assert.equal((test.context.db.prepare('SELECT count(*) AS n FROM events').get() as { n: number }).n, 2, 'preview changes nothing');

    const response = await test.restore(backup, 'restore');
    assert.equal(response.statusCode, 200, response.body);
    const report = response.json();
    assert.equal(report.config.included, true);
    assert.equal(report.config.applied, false);
    assert.equal(report.config.identical, true);
    assert.match(report.preRestoreBackup, /^pre-restore-backup-.*\.zip$/);
    assert.ok(existsSync(path.join(test.context.config.backupsDir, report.preRestoreBackup)));
    assert.match(String(response.headers['set-cookie']), /agt_session=;/);

    assert.equal((await test.app.inject({ method: 'GET', url: '/api/admin/session', headers: test.headers })).statusCode, 401);
    await test.relogin();
    const events = (await test.app.inject({ method: 'GET', url: '/api/admin/events', headers: test.headers })).json();
    assert.deepEqual(events.map((event: { name: string }) => event.name), ['Community Meetup']);
    const image = await test.app.inject({ method: 'GET', url: `/api/images/${events[0].coverImageId}` });
    assert.equal(image.statusCode, 200);
    assert.equal((await test.app.inject({ method: 'GET', url: '/api/settings/public' })).json().submissionsEnabled, false);
  });

  it('never applies config.yaml and ignores settings that the config file now defines', async () => {
    const source = await adminServer('');
    await seed(source);
    await source.app.inject({ method: 'PUT', url: '/api/admin/settings', headers: source.headers, payload: { values: { 'site.title': 'Dashboard Title' } } });
    const backup = await exportBackup(source);

    const target = await adminServer('site:\n  title: Configured Title\n');
    const report = (await target.restore(backup, 'restore')).json();
    assert.deepEqual(report.ignoredSettings, [{ key: 'site.title', reason: 'defined in the configuration file, which always wins' }]);
    assert.equal(report.config.included, false);
    assert.equal(target.context.config.rawText, 'site:\n  title: Configured Title\n');
    assert.equal((await target.app.inject({ method: 'GET', url: '/api/settings/public' })).json().siteTitle, 'Configured Title');
  });

  it('shows how a backed-up config.yaml differs from the current one', async () => {
    const source = await adminServer('site:\n  title: Old Title\n');
    const backup = await exportBackup(source);
    const target = await adminServer('site:\n  title: New Title\n');
    const report = (await target.restore(backup, 'preview')).json();
    assert.equal(report.config.identical, false);
    assert.equal(report.config.text, 'site:\n  title: Old Title\n');
    assert.deepEqual(report.config.diff.filter((line: string) => !line.startsWith('  ')), ['+   title: Old Title', '-   title: New Title']);
  });

  it('rejects tampered, corrupted, unexpected and newer-schema archives, leaving the instance unchanged', async () => {
    const test = await adminServer();
    await seed(test);
    const scratch = mkdtempSync(path.join(tmpdir(), 'agt-restore-'));
    const files = await readZip(scratch, await exportBackup(test));
    const expectRejected = async (zip: Buffer, pattern: RegExp) => {
      const response = await test.restore(zip, 'restore');
      assert.equal(response.statusCode, 422, response.body);
      assert.match(response.json().message, pattern);
      assert.equal((test.context.db.prepare('SELECT count(*) AS n FROM events').get() as { n: number }).n, 1);
    };

    const tampered = new Map(files);
    tampered.set('config.yaml', Buffer.from('site:\n  title: Evil\n'));
    await expectRejected(await rezip(scratch, tampered, { keepManifest: true }), /Checksum mismatch for config\.yaml/);

    const corrupted = new Map(files);
    const db = Buffer.from(files.get('database.sqlite')!);
    db.fill(0x41, 4096, 8192);
    corrupted.set('database.sqlite', db);
    await expectRejected(await rezip(scratch, corrupted), /integrity check|not a valid SQLite|malformed|cannot be opened/);

    const extra = new Map(files);
    extra.set('xx/evil.sh', Buffer.from('#!/bin/sh'));
    const traversal = Buffer.from((await rezip(scratch, extra)).toString('latin1').replaceAll('xx/evil.sh', '../evil.sh'), 'latin1');
    await expectRejected(traversal, /\.\./);

    const script = new Map(files);
    script.set('payload.js', Buffer.from('alert(1)'));
    await expectRejected(await rezip(scratch, script), /unexpected path: payload\.js/);

    const imageName = [...files.keys()].find((name) => name.startsWith('uploads/'))!;
    const fakeImage = new Map(files);
    fakeImage.set(imageName, Buffer.from('<svg onload="alert(1)"></svg>'));
    await expectRejected(await rezip(scratch, fakeImage), /was rejected/);

    const newer = new Map(files);
    const newerFile = path.join(scratch, 'newer.sqlite');
    writeFileSync(newerFile, files.get('database.sqlite')!);
    const newerDb = new Database(newerFile);
    newerDb.pragma('user_version = 99');
    newerDb.close();
    newer.set('database.sqlite', readFileSync(newerFile));
    await expectRejected(await rezip(scratch, newer), /schema version 99 is newer/);

    const noManifest = await makeZip(scratch, 'nomanifest.zip', [{ name: 'database.sqlite', data: files.get('database.sqlite')! }]);
    await expectRejected(noManifest, /no manifest/);

    assert.equal(readdirSync(test.context.config.backupsDir).filter((name) => name.startsWith('.')).length, 0, 'temp files cleaned up');
  });

  it('checks the manifest format exactly (BAK-2, BAK-7)', async () => {
    const test = await adminServer();
    await seed(test);
    const scratch = mkdtempSync(path.join(tmpdir(), 'agt-manifest-'));
    const files = await readZip(scratch, await exportBackup(test));

    const exported = JSON.parse(files.get('manifest.json')!.toString());
    assert.deepEqual(Object.keys(exported).sort(), ['appVersion', 'createdAt', 'files', 'format', 'formatVersion', 'schemaVersion']);
    assert.equal(exported.formatVersion, 1);
    assert.match(exported.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.deepEqual(
      exported.files.map((file: { path: string }) => file.path).sort(),
      [...files.keys()].filter((name) => name !== 'manifest.json').sort(),
    );
    for (const file of exported.files) assert.deepEqual(Object.keys(file).sort(), ['path', 'sha256', 'size']);

    const withManifest = (mutate: (manifest: Record<string, unknown>) => void, entries = files) => {
      const manifest = structuredClone(exported) as Record<string, unknown>;
      mutate(manifest);
      return makeZip(scratch, `${Math.random()}.zip`, [
        { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) },
        ...[...entries].filter(([name]) => name !== 'manifest.json').map(([name, data]) => ({ name, data })),
      ]);
    };
    const fileList = (manifest: Record<string, unknown>) => manifest.files as Record<string, unknown>[];
    const expectRejected = async (zip: Buffer, pattern: RegExp) => {
      // A restore re-runs the whole preview validation on its own upload (BAK-3).
      for (const action of ['preview', 'restore'] as const) {
        const response = await test.restore(zip, action);
        assert.equal(response.statusCode, 422, `${action}: ${response.body}`);
        assert.equal(response.json().error, 'archive_rejected');
        assert.match(response.json().message, pattern);
      }
      assert.equal((test.context.db.prepare('SELECT count(*) AS n FROM events').get() as { n: number }).n, 1);
    };

    await expectRejected(await withManifest((manifest) => { manifest.formatVersion = 2; }),
      /format version 2 is newer than this application supports \(1\)/);
    await expectRejected(await withManifest((manifest) => { manifest.formatVersion = '1'; }), /invalid formatVersion/);
    await expectRejected(await withManifest((manifest) => { manifest.formatVersion = 0; }), /invalid formatVersion/);
    await expectRejected(await withManifest((manifest) => { manifest.extra = true; }), /exactly the fields/);
    await expectRejected(await withManifest((manifest) => { Reflect.deleteProperty(manifest, 'appVersion'); }), /exactly the fields/);
    await expectRejected(await withManifest((manifest) => { manifest.schemaVersion = 'two'; }), /invalid schemaVersion/);
    await expectRejected(await withManifest((manifest) => { manifest.createdAt = '2026-11-10 06:30'; }), /invalid createdAt/);
    await expectRejected(await withManifest((manifest) => { fileList(manifest)[0].mode = 'rw'; }), /invalid files entry/);
    await expectRejected(await withManifest((manifest) => { fileList(manifest)[0].sha256 = 'ABC'; }), /invalid files entry/);
    for (const unsafe of ['../database.sqlite', '/database.sqlite', 'uploads/./x.png', 'uploads\\x.png', 'uploads//x.png', 'manifest.json']) {
      await expectRejected(await withManifest((manifest) => {
        fileList(manifest).push({ path: unsafe, size: 1, sha256: '0'.repeat(64) });
      }), /unsafe path/);
    }
    await expectRejected(await withManifest((manifest) => { fileList(manifest).push({ ...fileList(manifest)[0] }); }), /twice/);

    // Every entry but the manifest is listed, and every listed path exists.
    const unlisted = new Map(files);
    unlisted.set('uploads/0b6c2f1e-7d4a-4c1e-9a52-3f0e8d2b6a71.jpg', JPEG);
    await expectRejected(await withManifest(() => undefined, unlisted), /not listed in the manifest/);
    const missing = new Map(files);
    missing.delete('config.yaml');
    await expectRejected(await withManifest(() => undefined, missing), /listed in the manifest but missing/);
  });

  it('rejects a backup whose admin password hash fails the AUTH-2 check, in preview and restore', async () => {
    const test = await adminServer();
    const scratch = mkdtempSync(path.join(tmpdir(), 'agt-hash-'));
    const files = await readZip(scratch, await exportBackup(test));
    const dbFile = path.join(scratch, 'hostile.sqlite');
    writeFileSync(dbFile, files.get('database.sqlite')!);
    const db = new Database(dbFile);
    db.prepare('UPDATE admin SET password_hash = ?').run(`scrypt$1099511627776$8$1$${'A'.repeat(22)}==$${'A'.repeat(86)}==`);
    db.close();
    const hostile = new Map(files);
    hostile.set('database.sqlite', readFileSync(dbFile));
    const zip = await rezip(scratch, hostile);
    for (const action of ['preview', 'restore'] as const) {
      const response = await test.restore(zip, action);
      assert.equal(response.statusCode, 422, response.body);
      assert.match(response.json().message, /admin password hash is malformed/);
    }
    const session = await test.app.inject({ method: 'GET', url: '/api/admin/session', headers: test.headers });
    assert.equal(session.statusCode, 200, 'nothing was restored');
  });
});
