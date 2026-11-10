import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { OperationLock, asOperationOwner } from '../dataWrite';
import { writeImageFile } from '../images';
import { insertHoliday } from '../repository';
import { openSafeZip } from '../zip';
import { CSRF, JPEG, createTestServer, multipart, setupAdmin, validEvent } from './helpers';
import type { TestServer } from './helpers';

// The operation lock and the data-write barrier (AGT web app spec BAK-8, BAK-9, SRV-11, TEST-4).

const servers: TestServer[] = [];
after(async () => { for (const server of servers) await server.close(); });

const HOLIDAY = { name: 'Founding Day', civilization: 'AGT', date: '2018-12-05', type: 'Anniversary' };

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => { open = resolve; });
  return { promise, open };
}

async function until(condition: () => boolean, what: string) {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** True if the promise is still pending after a short while. */
async function pending(promise: Promise<unknown>) {
  const marker = Symbol('pending');
  return (await Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(marker), 50))])) === marker;
}

/** A server with test routes whose handlers wait on a gate: a data write (row + upload) and a read. */
async function harness() {
  const test = await createTestServer();
  servers.push(test);
  const gates = { write: gate(), read: gate() };
  test.app.post('/api/test/held-write', { config: { writesData: true } }, async () => {
    await gates.write.promise;
    insertHoliday(test.context.db, HOLIDAY, true);
    writeImageFile(test.context.config.uploadsDir, JPEG, 'image/jpeg');
    return { ok: true };
  });
  test.app.get('/api/test/held-read', { config: { writesData: false } }, async () => {
    await gates.read.promise;
    return { ok: true };
  });
  const headers = { cookie: await setupAdmin(test), ...CSRF };
  const lock = test.context.operation;
  const backup = () => test.app.inject({ method: 'GET', url: '/api/admin/backup', headers });
  const restore = (zip: Buffer) => {
    const body = multipart({ action: 'restore' }, [{ name: 'backup', fileName: 'backup.zip', contentType: 'application/zip', data: zip }]);
    return test.app.inject({ method: 'POST', url: '/api/admin/restore', payload: body.payload, headers: { ...headers, ...body.headers } });
  };
  const uploadImage = () => {
    const body = multipart({}, [{ name: 'file', fileName: 'c.jpg', contentType: 'image/jpeg', data: JPEG }]);
    return test.app.inject({ method: 'POST', url: '/api/admin/images', payload: body.payload, headers: { ...headers, ...body.headers } });
  };
  return { ...test, gates, headers, lock, backup, restore, uploadImage };
}

/** Holidays, images and upload files in a backup ZIP. */
async function backupContents(zip: Buffer) {
  const dir = mkdtempSync(path.join(tmpdir(), 'agt-ops-'));
  const zipFile = path.join(dir, 'backup.zip');
  writeFileSync(zipFile, zip);
  const archive = await openSafeZip(zipFile, { maxEntries: 1000, maxUncompressedBytes: 1e9 });
  const uploads = archive.entries.filter((entry) => entry.name.startsWith('uploads/') && !entry.isDirectory).length;
  const dbFile = path.join(dir, 'database.sqlite');
  writeFileSync(dbFile, await archive.read(archive.entries.find((entry) => entry.name === 'database.sqlite')!));
  archive.close();
  const db = new Database(dbFile, { readonly: true });
  const count = (table: string) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  const contents = { holidays: count('national_holidays'), images: count('images'), uploads };
  db.close();
  return contents;
}

describe('data writes (BAK-8)', () => {
  it('requires every /api/ route to declare writesData', async () => {
    const test = await createTestServer();
    servers.push(test);
    assert.throws(() => test.app.get('/api/test/undeclared', async () => ({ ok: true })), /must declare config\.writesData/);
    assert.throws(() => test.app.post('/api/test/undeclared', { config: {} }, async () => ({ ok: true })), /must declare config\.writesData/);
    // Routes outside /api/ (HTML, static files) are not data writes.
    test.app.get('/not-api', async () => 'ok');
  });

  it('throws when a writing repository or upload function runs outside withDataWrite()', async () => {
    const test = await createTestServer();
    servers.push(test);
    assert.throws(() => insertHoliday(test.context.db, HOLIDAY, true), /insertHoliday\(\) writes data outside withDataWrite\(\)/);
    assert.throws(() => writeImageFile(test.context.config.uploadsDir, JPEG, 'image/jpeg'), /writeImageFile\(\) writes data outside/);
    await test.context.operation.withDataWrite(() => insertHoliday(test.context.db, HOLIDAY, true));
    assert.equal((test.context.db.prepare('SELECT count(*) AS n FROM national_holidays').get() as { n: number }).n, 1);
  });

  it('GET routes, including the ALTCHA challenge on a fresh database, write nothing to the main database', async () => {
    const test = await createTestServer();
    servers.push(test);
    const changes = () => (test.context.db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
    const get = (url: string, headers: Record<string, string> = {}) => test.app.inject({ method: 'GET', url, headers });

    let before = changes();
    for (const url of ['/api/altcha/challenge', '/api/health', '/api/settings/public', '/api/events', '/api/holidays',
      '/api/changelog', '/api/setup/status', '/api/openapi.json']) {
      assert.ok((await get(url)).statusCode < 500, url);
    }
    assert.equal(changes(), before, 'public GET routes wrote to the main database');

    const headers = { cookie: await setupAdmin(test) };
    await test.app.inject({ method: 'POST', url: '/api/admin/events', headers: { ...headers, ...CSRF }, payload: validEvent });
    before = changes();
    for (const url of ['/api/admin/session', '/api/admin/events', '/api/admin/images', '/api/admin/holidays',
      '/api/admin/changelog', '/api/admin/settings', '/api/admin/logs/server', '/api/admin/logs/audit']) {
      assert.equal((await get(url, headers)).statusCode, 200, url);
    }
    assert.equal(changes(), before, 'admin GET routes wrote to the main database');
  });

  it('pauses jobs during a restore and runs them otherwise', async () => {
    const lock = new OperationLock();
    let runs = 0;
    await lock.runJob({ name: 'test', writesData: true }, () => asOperationOwner(() => { runs += 1; }));
    lock.state = 'restore';
    assert.equal(await lock.runJob({ name: 'test', writesData: false }, () => { runs += 1; }), undefined);
    assert.equal(runs, 1);
  });
});

describe('backup concurrency (BAK-8, BAK-9)', () => {
  it('includes a write already in progress when the backup starts', async () => {
    const test = await harness();
    const write = test.app.inject({ method: 'POST', url: '/api/test/held-write', headers: test.headers });
    await until(() => test.lock.dataWritesInProgress === 1, 'the held write');
    const backup = test.backup();
    await until(() => test.lock.state === 'backup', 'the backup state');
    assert.ok(await pending(backup), 'the backup waits for the write in progress');
    test.gates.write.open();
    assert.equal((await write).statusCode, 200);
    const response = await backup;
    assert.equal(response.statusCode, 200);
    assert.deepEqual(await backupContents(response.rawPayload), { holidays: 1, images: 0, uploads: 1 });
    assert.equal(test.lock.state, 'idle');
  });

  it('holds a write started during a backup until the snapshot is done, so the backup has none of it', async () => {
    const test = await harness();
    const snapshot = gate();
    test.lock.afterDrain = () => snapshot.promise;
    const backup = test.backup();
    await until(() => test.lock.state === 'backup', 'the backup state');
    const upload = test.uploadImage();
    assert.ok(await pending(upload), 'the write waits for the backup');
    const read = await test.app.inject({ method: 'GET', url: '/api/events' });
    assert.equal(read.statusCode, 200, 'reads proceed during a backup');
    snapshot.open();
    const response = await backup;
    assert.equal(response.statusCode, 200);
    assert.equal((await upload).statusCode, 201);
    assert.deepEqual(await backupContents(response.rawPayload), { holidays: 0, images: 0, uploads: 0 });
    assert.equal((test.context.db.prepare('SELECT count(*) AS n FROM images').get() as { n: number }).n, 1, 'the write succeeded afterwards');
  });

  it('returns 409 and changes nothing when a write is still running after the drain', async () => {
    const test = await harness();
    test.lock.drainMs = 100;
    const write = test.app.inject({ method: 'POST', url: '/api/test/held-write', headers: test.headers });
    await until(() => test.lock.dataWritesInProgress === 1, 'the held write');
    const response = await test.backup();
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, 'conflict');
    assert.match(response.json().message, /The server is busy\. Try again\./);
    assert.equal(test.lock.state, 'idle');
    test.gates.write.open();
    assert.equal((await write).statusCode, 200);
  });

  it('answers a write that waited too long for a backup with 503 maintenance and Retry-After', async () => {
    const test = await harness();
    test.lock.writeWaitMs = 100;
    const snapshot = gate();
    test.lock.afterDrain = () => snapshot.promise;
    const backup = test.backup();
    await until(() => test.lock.state === 'backup', 'the backup state');
    const response = await test.app.inject({ method: 'POST', url: '/api/admin/holidays', headers: test.headers, payload: HOLIDAY });
    assert.equal(response.statusCode, 503);
    assert.equal(response.headers['retry-after'], '10');
    assert.deepEqual(response.json(), {
      error: 'maintenance', message: 'Maintenance in progress. Try again in a moment.', params: { retryAfterSeconds: 10 },
    });
    snapshot.open();
    assert.equal((await backup).statusCode, 200);
    assert.equal((test.context.db.prepare('SELECT count(*) AS n FROM national_holidays').get() as { n: number }).n, 0);
  });

  it('refuses a second backup or a restore while one runs', async () => {
    const test = await harness();
    const zip = (await test.backup()).rawPayload;
    const snapshot = gate();
    test.lock.afterDrain = () => snapshot.promise;
    const backup = test.backup();
    await until(() => test.lock.state === 'backup', 'the backup state');
    for (const second of [await test.backup(), await test.restore(zip)]) {
      assert.equal(second.statusCode, 409);
      assert.match(second.json().message, /A backup or restore is already running\./);
    }
    snapshot.open();
    assert.equal((await backup).statusCode, 200);
  });
});

describe('restore maintenance (BAK-8, SRV-11)', () => {
  it('answers every /api/ request except health with 503 during a restore', async () => {
    const test = await harness();
    const zip = (await test.backup()).rawPayload;
    const swap = gate();
    test.lock.afterDrain = () => swap.promise;
    const restore = test.restore(zip);
    await until(() => test.lock.state === 'restore', 'the restore state');

    for (const request of [
      { method: 'GET' as const, url: '/api/events' },
      { method: 'GET' as const, url: '/api/admin/session' },
      { method: 'POST' as const, url: '/api/admin/login' },
      { method: 'GET' as const, url: '/api/no-such-route' },
    ]) {
      const response = await test.app.inject({ ...request, headers: test.headers });
      assert.equal(response.statusCode, 503, request.url);
      assert.equal(response.headers['retry-after'], '10');
      assert.equal(response.json().error, 'maintenance');
      assert.deepEqual(response.json().params, { retryAfterSeconds: 10 });
    }
    const health = await test.app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(health.statusCode, 200);
    assert.deepEqual(health.json(), { status: 'maintenance' });

    swap.open();
    assert.equal((await restore).statusCode, 200);
    assert.deepEqual((await test.app.inject({ method: 'GET', url: '/api/health' })).json(), { status: 'ok' });
    assert.equal(test.lock.activityInProgress, 0);
  });

  it('waits for every request in progress, and returns 409 with nothing changed if one is still running', async () => {
    const test = await harness();
    const zip = (await test.backup()).rawPayload;
    await test.app.inject({ method: 'POST', url: '/api/admin/holidays', headers: test.headers, payload: HOLIDAY });
    test.lock.drainMs = 100;
    const read = test.app.inject({ method: 'GET', url: '/api/test/held-read' });
    await until(() => test.lock.activityInProgress === 1, 'the held read');
    const response = await test.restore(zip);
    assert.equal(response.statusCode, 409, response.body);
    assert.match(response.json().message, /The server is busy/);
    assert.equal(test.lock.state, 'idle');
    assert.equal((test.context.db.prepare('SELECT count(*) AS n FROM national_holidays').get() as { n: number }).n, 1, 'nothing restored');
    test.gates.read.open();
    assert.equal((await read).statusCode, 200);

    test.lock.drainMs = 5000;
    test.gates.read = gate();
    const slow = test.app.inject({ method: 'GET', url: '/api/test/held-read' });
    await until(() => test.lock.activityInProgress === 1, 'the second held read');
    const restore = test.restore(zip);
    await until(() => test.lock.state === 'restore', 'the restore state');
    assert.ok(await pending(restore), 'the restore waits for the request in progress');
    test.gates.read.open();
    assert.equal((await slow).statusCode, 200);
    assert.equal((await restore).statusCode, 200);
    assert.equal((test.context.db.prepare('SELECT count(*) AS n FROM national_holidays').get() as { n: number }).n, 0, 'restored');
  });
});
