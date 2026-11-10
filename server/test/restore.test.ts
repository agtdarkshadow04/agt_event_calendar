import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { downloadBackup, restoreFailedMarkerPath } from '../backup';
import { restoreFailedError } from '../startup';
import { ADMIN, CSRF, JPEG, cookieFrom, createTestServer, multipart, setupAdmin, validEvent } from './helpers';
import type { TestServer } from './helpers';

// The restore procedure, rollback and failed-restore recovery (AGT web app spec BAK-4, BAK-10, BAK-11, TEST-4).

const servers: TestServer[] = [];
after(async () => { for (const server of servers) await server.close(); });

async function restoreServer() {
  const test = await createTestServer();
  servers.push(test);
  const headers = { cookie: await setupAdmin(test), ...CSRF };
  const lock = test.context.operation;
  const inject = (method: 'GET' | 'POST' | 'PUT', url: string, cookie: string, payload?: unknown) =>
    test.app.inject({ method, url, headers: { cookie, ...CSRF }, payload: payload as never });
  const restore = (zip: Buffer, action: 'preview' | 'restore', cookie = headers.cookie) => {
    const body = multipart({ action }, [{ name: 'backup', fileName: 'backup.zip', contentType: 'application/zip', data: zip }]);
    return test.app.inject({ method: 'POST', url: '/api/admin/restore', payload: body.payload, headers: { cookie, ...CSRF, ...body.headers } });
  };
  const login = async () => cookieFrom(await test.app.inject({ method: 'POST', url: '/api/admin/login', headers: CSRF, payload: ADMIN }));
  const count = (table: string) => (test.context.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  const leftovers = () => readdirSync(test.context.config.dataDir).filter((name) => /\.restore-(old|new)-/.test(name));
  const serverLog = (source: string) => test.context.logs.listServer({ source }, 100).items;

  // A backup with one event and an image; then the live data moves on, so a restore would change it.
  const image = multipart({}, [{ name: 'file', fileName: 'c.jpg', contentType: 'image/jpeg', data: JPEG }]);
  await test.app.inject({ method: 'POST', url: '/api/admin/images', payload: image.payload, headers: { ...headers, ...image.headers } });
  await inject('POST', '/api/admin/events', headers.cookie, validEvent);
  const zip = (await inject('GET', '/api/admin/backup', headers.cookie)).rawPayload;
  await inject('POST', '/api/admin/events', headers.cookie, { ...validEvent, name: 'After the backup' });
  await inject('PUT', '/api/admin/settings', headers.cookie, { values: { 'submissions.enabled': false } });

  /** The live state that a failed, rolled-back restore must leave exactly as it was. */
  const snapshot = async () => ({
    events: count('events'),
    images: count('images'),
    settings: (await inject('GET', '/api/admin/settings', headers.cookie)).json(),
    session: (await inject('GET', '/api/admin/session', headers.cookie)).statusCode,
  });
  return { ...test, headers, lock, inject, restore, login, count, leftovers, serverLog, zip, snapshot };
}

describe('restore rollback (BAK-4, BAK-10)', () => {
  it('rolls back a restore whose health check fails after the swap', async () => {
    const test = await restoreServer();
    const before = await test.snapshot();
    // The restored data references an upload that is gone: the step 5 health check fails.
    test.lock.restoreHooks.afterSwap = () => {
      for (const name of readdirSync(test.context.config.uploadsDir)) rmSync(path.join(test.context.config.uploadsDir, name));
    };
    const response = await test.restore(test.zip, 'restore');
    assert.equal(response.statusCode, 500, response.body);
    assert.deepEqual(response.json(), { error: 'internal', message: 'The restore failed and was rolled back. Nothing was changed.' });
    test.lock.restoreHooks = {};

    assert.deepEqual(await test.snapshot(), before, 'data, settings and the session are as they were');
    assert.equal(test.lock.state, 'idle');
    assert.equal(test.lock.recovery, null);
    assert.deepEqual(test.leftovers(), []);
    assert.equal(existsSync(restoreFailedMarkerPath(test.context.config.dataDir)), false);
    assert.ok(readdirSync(test.context.config.backupsDir).some((name) => name.startsWith('pre-restore-backup-')), 'pre-restore backup kept');
    assert.ok(test.serverLog('backup').some((entry) => entry.level === 'error' && /rolled back/.test(entry.message)));
  });

  it('rolls back a restore whose commit (step 6.1) fails', async () => {
    const test = await restoreServer();
    const before = await test.snapshot();
    test.lock.restoreHooks.inCommit = () => { throw new Error('Simulated commit failure'); };
    const response = await test.restore(test.zip, 'restore');
    assert.equal(response.statusCode, 500);
    assert.match(response.json().message, /rolled back\. Nothing was changed\./);
    test.lock.restoreHooks = {};
    assert.deepEqual(await test.snapshot(), before);
    assert.deepEqual(test.leftovers(), []);

    // The same backup restores fine afterwards.
    const ok = await test.restore(test.zip, 'restore');
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(test.count('events'), 1);
  });

  it('still succeeds with warnings when set-aside paths cannot be deleted', async () => {
    const test = await restoreServer();
    test.lock.restoreHooks.cleanup = (setAside) => {
      if (/\.sqlite\.restore-old-/.test(setAside)) throw new Error('Simulated permission error');
    };
    const response = await test.restore(test.zip, 'restore');
    assert.equal(response.statusCode, 200, response.body);
    const { warnings } = response.json() as { warnings: string[] };
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /agt-calendar\.sqlite\.restore-old-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z could not be deleted/);
    assert.equal(test.leftovers().length, 1, 'left for the operator, never deleted later');
    assert.ok(test.serverLog('backup').some((entry) => entry.level === 'warn' && /could not be deleted/.test(entry.message)));
    assert.equal(test.lock.state, 'idle');
    assert.equal(test.count('events'), 1, 'restored');
    assert.equal((await test.inject('GET', '/api/admin/session', test.headers.cookie)).statusCode, 401, 'the caller is signed out');
  });
});

describe('failed restore (BAK-11)', () => {
  async function failedServer() {
    const test = await restoreServer();
    const other = await test.login();
    test.lock.restoreHooks.afterSwap = () => { throw new Error('Simulated failure after the swap'); };
    test.lock.restoreHooks.rollback = () => { throw new Error('Simulated rollback failure'); };
    const response = await test.restore(test.zip, 'restore');
    test.lock.restoreHooks = {};
    return { ...test, other, response };
  }

  it('stays in maintenance with the marker file, and a restart refuses', async () => {
    const test = await failedServer();
    assert.equal(test.response.statusCode, 500);
    assert.deepEqual(test.response.json(), { error: 'internal', message: 'The restore failed. The app stays in maintenance.' });
    assert.equal(test.lock.state, 'restore_failed');

    const markerFile = restoreFailedMarkerPath(test.context.config.dataDir);
    const marker = JSON.parse(readFileSync(markerFile, 'utf8')) as { preRestoreBackup: string; failedAt: string };
    assert.deepEqual(Object.keys(marker).sort(), ['failedAt', 'preRestoreBackup']);
    assert.match(marker.preRestoreBackup, /^pre-restore-backup-.*\.zip$/);
    assert.ok(existsSync(path.join(test.context.config.backupsDir, marker.preRestoreBackup)));
    const error = test.serverLog('backup').find((entry) => entry.level === 'error')!;
    assert.ok(error.message.includes(marker.preRestoreBackup), 'the server log names the pre-restore backup');

    const refusal = restoreFailedError(test.context.config.dataDir);
    assert.ok(refusal?.includes(marker.preRestoreBackup));
    assert.match(refusal!, /README \(Troubleshooting: "A restore failed and the app stays in maintenance"\)/);

    assert.deepEqual((await test.app.inject({ method: 'GET', url: '/api/health' })).json(), { status: 'maintenance' });
    assert.equal((await test.app.inject({ method: 'GET', url: '/api/events' })).statusCode, 503);
    assert.equal((await test.app.inject({ method: 'POST', url: '/api/admin/login', headers: CSRF, payload: ADMIN })).statusCode, 503);
    // A normal operation does not start from restore_failed.
    await assert.rejects(downloadBackup(test.context), (rejection: { statusCode?: number }) => rejection.statusCode === 409);
    await assert.rejects(test.lock.run('restore', async () => 'restored'), (rejection: { statusCode?: number }) => rejection.statusCode === 409);
    assert.equal(test.lock.state, 'restore_failed');
  });

  it('accepts only the recovery session, only for the session check and restores, and only until it expires', async () => {
    const test = await failedServer();
    const session = await test.inject('GET', '/api/admin/session', test.headers.cookie);
    assert.equal(session.statusCode, 200);
    assert.equal(session.json().username, ADMIN.username);
    assert.equal((await test.inject('GET', '/api/admin/events', test.headers.cookie)).statusCode, 503, 'other routes stay closed');
    assert.equal((await test.inject('GET', '/api/admin/session', test.other)).statusCode, 503, 'another session is refused');
    assert.equal((await test.app.inject({ method: 'GET', url: '/api/admin/session' })).statusCode, 503);

    test.lock.recovery!.expiresAt = Date.now() - 1;
    assert.equal((await test.inject('GET', '/api/admin/session', test.headers.cookie)).statusCode, 503, 'expired');
    assert.equal((await test.restore(test.zip, 'preview')).statusCode, 503);
  });

  it('recovers with a recovery restore from the recovery session, end to end', async () => {
    const test = await failedServer();
    const preview = await test.restore(test.zip, 'preview');
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal(test.lock.state, 'restore_failed', 'a preview changes nothing');

    // A failed recovery restore leaves everything as it was: no rollback, same marker and recovery session.
    const markerFile = restoreFailedMarkerPath(test.context.config.dataDir);
    const marker = readFileSync(markerFile, 'utf8');
    test.lock.restoreHooks.inCommit = () => { throw new Error('Simulated commit failure'); };
    const failed = await test.restore(test.zip, 'restore');
    test.lock.restoreHooks = {};
    assert.equal(failed.statusCode, 500);
    assert.match(failed.json().message, /The app stays in maintenance/);
    assert.equal(test.lock.state, 'restore_failed');
    assert.equal(readFileSync(markerFile, 'utf8'), marker);
    assert.equal((await test.inject('GET', '/api/admin/session', test.headers.cookie)).statusCode, 200);

    const backupsBefore = readdirSync(test.context.config.backupsDir).filter((name) => name.startsWith('pre-restore-backup-'));
    const response = await test.restore(test.zip, 'restore');
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().preRestoreBackup, null, 'the recovery restore skips the pre-restore backup');
    assert.deepEqual(readdirSync(test.context.config.backupsDir).filter((name) => name.startsWith('pre-restore-backup-')), backupsBefore);
    assert.equal(test.lock.state, 'idle');
    assert.equal(test.lock.recovery, null);
    assert.equal(existsSync(markerFile), false);
    assert.equal(restoreFailedError(test.context.config.dataDir), null);
    assert.deepEqual((await test.app.inject({ method: 'GET', url: '/api/health' })).json(), { status: 'ok' });
    assert.equal(test.count('events'), 1, 'the backup is live');
    for (const cookie of [test.headers.cookie, test.other]) {
      assert.equal((await test.inject('GET', '/api/admin/session', cookie)).statusCode, 401, 'every session ended');
    }
    assert.equal((await test.app.inject({ method: 'POST', url: '/api/admin/login', headers: CSRF, payload: ADMIN })).statusCode, 200);
  });
});
