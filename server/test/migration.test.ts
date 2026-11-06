import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import yazl from 'yazl';
import { CSRF, FIXTURES, createTestServer, fixtureFiles, makeZip, multipart, setupAdmin } from './helpers';
import type { TestServer } from './helpers';

const REFERENCE = path.join(FIXTURES, 'amplify-migration');
const servers: TestServer[] = [];
after(async () => { for (const server of servers) await server.close(); });

async function adminServer(config?: string) {
  const server = await createTestServer({ config });
  servers.push(server);
  const headers = { cookie: await setupAdmin(server), ...CSRF };
  const migrate = (zip: Buffer, mode: 'preview' | 'commit', onExisting = 'skip') => {
    const body = multipart({ mode, onExisting }, [{ name: 'zip', fileName: 'migration.zip', contentType: 'application/zip', data: zip }]);
    return server.app.inject({ method: 'POST', url: '/api/admin/migrate', payload: body.payload, headers: { ...headers, ...body.headers } });
  };
  return { ...server, headers, migrate };
}

let referenceZip: Buffer;
let scratch: TestServer;
before(async () => {
  scratch = await createTestServer();
  servers.push(scratch);
  referenceZip = await makeZip(scratch.dir, 'reference.zip', fixtureFiles(REFERENCE));
});

function withFiles(overrides: Record<string, Buffer | string | null>) {
  const files = fixtureFiles(REFERENCE).filter((file) => !(file.name in overrides));
  for (const [name, data] of Object.entries(overrides)) if (data !== null) files.push({ name, data: Buffer.from(data) });
  return makeZip(scratch.dir, `${Math.random()}.zip`, files);
}

describe('Migrate from Amplify: reference ZIP', () => {
  it('previews without writing anything', async () => {
    const { migrate, context } = await adminServer();
    const response = await migrate(referenceZip, 'preview');
    assert.equal(response.statusCode, 200, response.body);
    const report = response.json();
    assert.equal(report.dryRun, true);
    assert.equal(report.events.toCreate, 8);
    assert.equal(report.events.alreadyMigrated, 0);
    assert.equal(report.events.skipped, 0);
    assert.equal(report.holidays.toCreate, 15);
    assert.equal(report.descriptionsStored, 4);
    assert.equal(report.coversStored, 2);
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.missingFiles.sort(), [
      'covers/0000.jpg', 'covers/0003.jpg', 'covers/0004.jpg', 'covers/0005.jpg', 'covers/0008.jpg',
      'markdown/0003.md', 'markdown/0004.md', 'markdown/0005.md', 'markdown/0008.md',
    ]);
    assert.equal(report.warnings.filter((warning: string) => /markdown\/.*missing/.test(warning)).length, 4);
    assert.equal(report.warnings.filter((warning: string) => /covers\/.*missing/.test(warning)).length, 5);
    assert.equal(report.warnings.length, 9);
    assert.deepEqual(report.unreferencedFiles, ['covers/test.jpg', 'markdown/TEMPLATE.md', 'markdown/TEST.md']);
    assert.equal(context.db.prepare('SELECT count(*) AS n FROM events').get().n, 0);
    assert.equal(context.db.prepare('SELECT count(*) AS n FROM images').get().n, 0);
  });

  it('commits in one transaction, then skips everything on a re-run', async () => {
    const { app, migrate, context, headers } = await adminServer();
    const committed = await migrate(referenceZip, 'commit');
    assert.equal(committed.statusCode, 200, committed.body);
    assert.equal(committed.json().dryRun, false);

    const events = (await app.inject({ method: 'GET', url: '/api/admin/events', headers })).json();
    assert.equal(events.length, 8);
    assert.deepEqual(events.map((event: { legacyId: string }) => event.legacyId).sort(), ['0000', '0001', '0002', '0003', '0004', '0005', '0008', '8000']);
    for (const event of events) {
      assert.equal(event.status, 'published');
      assert.match(event.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    const byLegacy = Object.fromEntries(events.map((event: { legacyId: string }) => [event.legacyId, event]));
    assert.match(byLegacy['0000'].description, /\[AGT website\]\(<https:\/\/www\.nms-agt\.com>\)/);
    assert.match(byLegacy['0002'].description, /archive’s/, 'UTF-8 punctuation survives');
    assert.equal(byLegacy['0003'].description, null);
    assert.ok(byLegacy['0001'].coverImageId);
    assert.ok(byLegacy['0002'].coverImageId);
    assert.equal(byLegacy['0000'].coverImageId, null);
    assert.equal(byLegacy['8000'].coverImageId, null);
    assert.deepEqual(byLegacy['0000'].links, ['https://www.nms-agt.com/', 'https://www.nms-agt.com/about-the-agt']);
    assert.equal(byLegacy['0002'].region, 'TBA');
    assert.equal(byLegacy['0002'].portalCode, '000000000000');
    assert.equal(byLegacy['0004'].name, 'Racing League, Round 1');

    assert.equal((await app.inject({ method: 'GET', url: '/api/holidays' })).json().length, 15);
    assert.equal(readdirSync(context.config.uploadsDir).length, 2);
    const image = await app.inject({ method: 'GET', url: `/api/images/${byLegacy['0001'].coverImageId}` });
    assert.deepEqual(image.rawPayload, readFileSync(path.join(REFERENCE, 'covers/0001.jpg')));

    const resolved = await app.inject({ method: 'GET', url: '/api/events/8000' });
    assert.equal(resolved.json().id, byLegacy['8000'].id);

    const rerun = (await migrate(referenceZip, 'commit')).json();
    assert.equal(rerun.events.toCreate, 0);
    assert.equal(rerun.events.alreadyMigrated, 8);
    assert.equal(rerun.holidays.toCreate, 0);
    assert.equal(rerun.holidays.alreadyPresent, 15);
    assert.equal(context.db.prepare('SELECT count(*) AS n FROM events').get().n, 8);
    assert.equal(context.db.prepare('SELECT count(*) AS n FROM national_holidays').get().n, 15);
    assert.equal(readdirSync(context.config.uploadsDir).length, 2);
  });

  it('overwrites already-migrated events on request, keeping their UUIDs', async () => {
    const { app, migrate, headers } = await adminServer();
    await migrate(referenceZip, 'commit');
    const before = (await app.inject({ method: 'GET', url: '/api/admin/events', headers })).json();
    const changed = await withFiles({ 'markdown/8000.md': '# Updated\n' });
    const report = (await migrate(changed, 'commit', 'overwrite')).json();
    assert.equal(report.events.toOverwrite, 8);
    const after = (await app.inject({ method: 'GET', url: '/api/admin/events', headers })).json();
    assert.deepEqual(after.map((event: { id: string }) => event.id).sort(), before.map((event: { id: string }) => event.id).sort());
    assert.equal(after.find((event: { legacyId: string }) => event.legacyId === '8000').description, '# Updated\n');
  });

  it('rejects the wrapper-folder variant before parsing, naming the folder', async () => {
    const { migrate, context } = await adminServer();
    const wrapped = await makeZip(scratch.dir, 'wrapped.zip', fixtureFiles(REFERENCE, 'agt_event_calendar_files/'));
    const response = await migrate(wrapped, 'preview');
    assert.equal(response.statusCode, 422);
    assert.equal(
      response.json().message,
      'csv/, markdown/ and covers/ must be at the root of the ZIP, but they are inside agt_event_calendar_files/. Select those three folders and compress them directly.',
    );
    assert.equal(context.db.prepare('SELECT count(*) AS n FROM events').get().n, 0);
  });
});

describe('Migrate from Amplify: malformed and unsafe ZIPs', () => {
  it('identifies CSVs by header and rejects other tabs, including form responses', async () => {
    const { migrate } = await adminServer();
    const renamed = await withFiles({
      'csv/publishedEventDB.csv': null,
      'csv/publishedHolidayDB.csv': null,
      'csv/AGT Calendar - one.csv': readFileSync(path.join(REFERENCE, 'csv/publishedHolidayDB.csv')),
      'csv/two.csv': readFileSync(path.join(REFERENCE, 'csv/publishedEventDB.csv')),
    });
    assert.equal((await migrate(renamed, 'preview')).json().events.toCreate, 8);

    const formResponses = await withFiles({
      'csv/publishedHolidayDB.csv': null,
      'csv/formResponses.csv': 'Timestamp,Email Address,Event Name\r\n2025-01-01,a@example.com,Test\r\n',
    });
    const rejected = await migrate(formResponses, 'preview');
    assert.equal(rejected.statusCode, 422);
    assert.match(rejected.json().message, /formResponses\.csv does not match the publishedEventDB or publishedHolidayDB format.*form-response tabs are never imported/);

    const master = await withFiles({
      'csv/publishedEventDB.csv': 'EVENT_ID,EVENT_ID_DEC,PUBLISH,EVENT_NAME\r\n0000,0,Yes,Test\r\n',
    });
    assert.match((await migrate(master, 'preview')).json().message, /eventDB master tab.*publishedEventDB/);

    const missingCsv = await withFiles({ 'csv/publishedHolidayDB.csv': null });
    assert.match((await migrate(missingCsv, 'preview')).json().message, /exactly two CSV files/);

    const noCsv = await makeZip(scratch.dir, 'nocsv.zip', fixtureFiles(path.join(REFERENCE, 'markdown'), 'markdown/'));
    assert.match((await migrate(noCsv, 'preview')).json().message, /csv\/ folder at its root/);
  });

  it('reports invalid rows with source row numbers and ignores OS clutter', async () => {
    const { migrate } = await adminServer();
    const csv = readFileSync(path.join(REFERENCE, 'csv/publishedEventDB.csv'), 'utf8')
      + 'ZZZZ,Broken,2025-01-01T00:00:00Z,,,Meetup,,,,Euclid,R,S,,0123ABCD4567\r\n';
    const zip = await withFiles({
      'csv/publishedEventDB.csv': csv,
      '__MACOSX/csv/._publishedEventDB.csv': 'junk',
      'csv/.DS_Store': 'junk',
      'notes.txt': 'hello',
    });
    const report = (await migrate(zip, 'preview')).json();
    assert.equal(report.events.toCreate, 8);
    assert.equal(report.events.skipped, 1);
    assert.deepEqual(report.errors[0].row, 10);
    assert.ok(report.ignoredEntries.includes('__MACOSX/csv/._publishedEventDB.csv'));
    assert.ok(report.ignoredEntries.includes('notes.txt'));
  });

  it('rejects path traversal, absolute paths and symlinks', async () => {
    const { migrate } = await adminServer();
    const base = await makeZip(scratch.dir, 'slip.zip', [...fixtureFiles(REFERENCE), { name: 'xx/evil.txt', data: Buffer.from('x') }]);
    const slip = Buffer.from(base.toString('latin1').replaceAll('xx/evil.txt', '../evil.txt'), 'latin1');
    const slipResponse = await migrate(slip, 'preview');
    assert.equal(slipResponse.statusCode, 422);
    assert.match(slipResponse.json().message, /\.\.|invalid/i);

    const absolute = Buffer.from(base.toString('latin1').replaceAll('xx/evil.txt', '/x/evil.txt'), 'latin1');
    assert.equal((await migrate(absolute, 'preview')).statusCode, 422);

    const zip = new yazl.ZipFile();
    for (const file of fixtureFiles(REFERENCE)) zip.addBuffer(file.data, file.name);
    zip.addBuffer(Buffer.from('/etc/passwd'), 'covers/link.jpg', { mode: 0o120777 });
    zip.end();
    const chunks: Buffer[] = [];
    for await (const chunk of zip.outputStream) chunks.push(chunk as Buffer);
    const symlink = await migrate(Buffer.concat(chunks), 'preview');
    assert.equal(symlink.statusCode, 422);
    assert.match(symlink.json().message, /symbolic link/);
  });

  it('rejects zip bombs, too many entries, oversized uploads and non-ZIP files', async () => {
    const bomb = await adminServer('migration:\n  maxUncompressedBytes: 100000\n');
    const big = await withFiles({ 'covers/huge.jpg': Buffer.alloc(200_000, 0) });
    const response = await bomb.migrate(big, 'preview');
    assert.equal(response.statusCode, 422);
    assert.match(response.json().message, /expands to more than/);

    const entries = await adminServer('migration:\n  maxEntries: 5\n');
    assert.match((await entries.migrate(referenceZip, 'preview')).json().message, /entries; the limit is 5/);

    const size = await adminServer('migration:\n  maxZipBytes: 10000\n');
    assert.equal((await size.migrate(referenceZip, 'preview')).statusCode, 413);

    const notZip = await adminServer();
    const garbage = await notZip.migrate(Buffer.from('not a zip at all'), 'preview');
    assert.equal(garbage.statusCode, 422);
    assert.match(garbage.json().message, /not a valid ZIP/);
  });

  it('imports events without a cover when the cover fails the image checks', async () => {
    const { migrate } = await adminServer();
    const zip = await withFiles({ 'covers/0001.jpg': '<svg onload="alert(1)"/>' });
    const report = (await migrate(zip, 'preview')).json();
    assert.equal(report.coversStored, 1);
    assert.ok(report.warnings.some((warning: string) => /covers\/0001\.jpg was rejected/.test(warning)));
  });
});
