import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { after, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { outcomeFor } from '../audit';
import { parseConfigText, resolveConfig } from '../config';
import type { AppContext } from '../context';
import { OperationLock } from '../dataWrite';
import { MIGRATIONS, openDatabase } from '../db';
import type { Migration } from '../db';
import { LOG_MIGRATIONS, LogStore, createLogger, csvCell, normalizeIp, runRetention } from '../logs';
import type { NewAuditEntry } from '../logs';
import { logStartup } from '../startup';
import { openSafeZip } from '../zip';
import { ADMIN, CSRF, SETUP_PASSWORD, createTestServer, multipart, setupAdmin, validEvent } from './helpers';
import type { TestServer } from './helpers';

const servers: TestServer[] = [];
const dirs: string[] = [];
after(async () => {
  for (const server of servers) await server.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
async function server(options: Parameters<typeof createTestServer>[0] = {}) {
  const created = await createTestServer(options);
  servers.push(created);
  return created;
}

const auditEntries = (test: TestServer) => test.context.logs.listAudit({}, 200).items;
const serverEntries = (test: TestServer) => test.context.logs.listServer({}, 200).items;
/** Everything in both logs as text, to look for values that must never be stored. */
const logDump = (test: TestServer) => JSON.stringify([
  test.context.logs.db.prepare('SELECT * FROM audit_log').all(),
  test.context.logs.db.prepare('SELECT * FROM server_log').all(),
]);
/** Total number of audited events (coalesced entries count several times). */
function auditTotal(test: TestServer, action: string, outcome?: string, statusCode?: number): number {
  return auditEntries(test)
    .filter((entry) => entry.action === action && (outcome === undefined || entry.outcome === outcome)
      && (statusCode === undefined || entry.statusCode === statusCode))
    .reduce((total, entry) => total + entry.count, 0);
}

type Doc = { paths: Record<string, Record<string, { operationId: string }>> };
async function operationIds(test: TestServer): Promise<(method: string, url: string) => string> {
  const doc = (await test.app.inject({ method: 'GET', url: '/api/openapi.json' })).json() as Doc;
  return (method, url) => doc.paths[url.replace(/:([A-Za-z0-9_]+)/g, '{$1}')][method.toLowerCase()].operationId;
}
const concrete = (url: string) => url.replace(/:[A-Za-z0-9_]+/g, '00000000-0000-4000-8000-000000000000');

function auditEntry(overrides: Partial<NewAuditEntry>): NewAuditEntry {
  return {
    actorType: 'admin', actor: 'admin', ipHash: 'abcdef0123456789', client: 'api', action: 'testAction',
    method: 'POST', route: '/api/test', targetType: null, targetId: null, outcome: 'success', statusCode: 200,
    requestId: null, details: {}, ...overrides,
  };
}

describe('audit log', () => {
  it('records every non-GET route and every audited GET route, with the right outcome', async () => {
    const test = await server();
    const operationId = await operationIds(test);
    const audited = test.app.apiRoutes.filter((route) => !route.hidden && (route.method !== 'GET' || route.audit));
    assert.ok(audited.length >= 25, `expected all audited routes, got ${audited.length}`);
    for (const url of ['/api/admin/backup', '/api/admin/logs/server/export', '/api/admin/logs/audit/export']) {
      assert.ok(audited.some((route) => route.method === 'GET' && route.url === url), `GET ${url} is audited`);
    }
    // Ordinary reads are not audited.
    assert.ok(!audited.some((route) => route.url === '/api/events' || route.url === '/api/admin/events' && route.method === 'GET'));

    // Anonymous: every admin route is denied; the public ones fail validation or succeed.
    for (const route of audited) {
      const action = operationId(route.method, route.url);
      const counted = (status: number) => auditTotal(test, action, outcomeFor(status), status);
      const response = await test.app.inject({ method: route.method as 'GET', url: concrete(route.url), headers: CSRF });
      const before = counted(response.statusCode) - 1;
      assert.ok(before >= 0, `anonymous ${route.method} ${route.url} wrote an audit entry`);
      if (route.url.startsWith('/api/admin/') && route.url !== '/api/admin/login' && route.url !== '/api/admin/logout') {
        assert.equal(response.statusCode, 401);
        assert.equal(outcomeFor(response.statusCode), 'denied');
      }
    }

    // Signed in but without the CSRF header: denied (403).
    const cookie = await setupAdmin(test);
    for (const route of audited.filter((candidate) => candidate.method !== 'GET' && candidate.url.startsWith('/api/admin/')
      && candidate.url !== '/api/admin/login' && candidate.url !== '/api/admin/logout')) {
      const action = operationId(route.method, route.url);
      const before = auditTotal(test, action, 'denied', 403);
      const response = await test.app.inject({ method: route.method as 'POST', url: concrete(route.url), headers: { cookie } });
      assert.equal(response.statusCode, 403);
      assert.equal(auditTotal(test, action, 'denied', 403), before + 1, `${route.method} ${route.url} without CSRF is audited as denied`);
    }

    // Signed in with an empty or invalid request: validation failures (or successes for parameterless actions).
    const signedIn = audited.filter((route) => route.url !== '/api/admin/logout').concat(audited.filter((route) => route.url === '/api/admin/logout'));
    for (const route of signedIn) {
      const action = operationId(route.method, route.url);
      const response = await test.app.inject({ method: route.method as 'POST', url: concrete(route.url), headers: { cookie, ...CSRF } });
      assert.notEqual(response.statusCode, 500, `${route.method} ${route.url}: ${response.body}`);
      const outcome = outcomeFor(response.statusCode);
      const entries = auditEntries(test).filter((entry) => entry.action === action && entry.statusCode === response.statusCode);
      assert.ok(entries.length > 0, `${route.method} ${route.url} (${response.statusCode}) is audited`);
      assert.equal(entries[0].outcome, outcome);
      if (outcome === 'failure') assert.ok(entries[0].details.error, `${route.method} ${route.url} records the error code`);
    }
    const failedSchema = auditEntries(test).find((entry) => entry.action === 'createAdminHoliday' && entry.statusCode === 400)!;
    assert.equal(failedSchema.actorType, 'admin');
    assert.equal(failedSchema.actor, ADMIN.username);
    assert.equal(failedSchema.route, '/api/admin/holidays');
    assert.equal(failedSchema.method, 'POST');
  });

  it('records 429 responses from any route, including GET routes', async () => {
    const test = await server({ config: 'rateLimits:\n  login:\n    max: 1\n    windowMinutes: 1\n' });
    const login = () => test.app.inject({ method: 'POST', url: '/api/admin/login', headers: CSRF, payload: { username: 'x', password: 'y' } });
    assert.equal((await login()).statusCode, 401);
    assert.equal((await login()).statusCode, 429);
    assert.equal((await login()).statusCode, 429);
    const limited = auditEntries(test).find((entry) => entry.action === 'login' && entry.outcome === 'rate_limited')!;
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.count, 2, 'rate-limited attempts are coalesced');

    let status = 0;
    for (let index = 0; index < 61 && status !== 429; index += 1) {
      status = (await test.app.inject({ method: 'GET', url: '/api/altcha/challenge' })).statusCode;
    }
    assert.equal(status, 429);
    assert.equal(auditEntries(test).filter((entry) => entry.action === 'getAltchaChallenge').map((entry) => entry.outcome).join(), 'rate_limited',
      'only the rate-limited GET is audited');
  });

  it('audits and coalesces failed setup and login attempts', async () => {
    const test = await server();
    for (let index = 0; index < 3; index += 1) {
      const response = await test.app.inject({
        method: 'POST', url: '/api/setup', headers: CSRF, payload: { setupPassword: 'wrong-guess-123', ...ADMIN },
      });
      assert.equal(response.statusCode, 401);
    }
    const setupFailures = auditEntries(test).filter((entry) => entry.action === 'setupAdmin');
    assert.equal(setupFailures.length, 1);
    assert.equal(setupFailures[0].count, 3);
    assert.equal(setupFailures[0].outcome, 'denied');
    assert.equal(setupFailures[0].actorType, 'anonymous');
    assert.ok(setupFailures[0].lastAt >= setupFailures[0].at);

    await setupAdmin(test);
    const setup = auditEntries(test).find((entry) => entry.action === 'setupAdmin' && entry.outcome === 'success')!;
    assert.equal(setup.actorType, 'admin');
    assert.equal(setup.actor, ADMIN.username);
    assert.deepEqual(setup.details, {});

    for (let index = 0; index < 2; index += 1) {
      await test.app.inject({ method: 'POST', url: '/api/admin/login', headers: CSRF, payload: { username: 'admin', password: 'not-the-password' } });
    }
    const loginFailure = auditEntries(test).find((entry) => entry.action === 'login' && entry.outcome === 'denied')!;
    assert.equal(loginFailure.count, 2);
    assert.equal(loginFailure.actor, null);
    assert.deepEqual(loginFailure.details, { error: 'invalid_credentials' });

    const ok = await test.app.inject({ method: 'POST', url: '/api/admin/login', headers: CSRF, payload: ADMIN });
    assert.equal(ok.statusCode, 200);
    const success = auditEntries(test).find((entry) => entry.action === 'login' && entry.outcome === 'success')!;
    assert.equal(success.actorType, 'admin');
    assert.equal(success.actor, ADMIN.username);
    assert.equal(success.count, 1);

    const cookie = String(ok.headers['set-cookie']).split(';')[0];
    await test.app.inject({ method: 'POST', url: '/api/admin/logout', headers: { cookie, ...CSRF } });
    const logout = auditEntries(test).find((entry) => entry.action === 'logout')!;
    assert.equal(logout.actorType, 'admin', 'logout is attributed to the admin whose session it ended');
  });

  it('stores a pseudonymous IP hash and never the raw IP', async () => {
    const test = await server();
    const send = (remoteAddress: string) => test.app.inject({
      method: 'POST', url: '/api/admin/login', headers: CSRF, payload: { username: 'a', password: 'b' }, remoteAddress,
    });
    await send('203.0.113.7');
    await send('::ffff:203.0.113.7');
    await send('2001:db8:1:2::1');
    await send('2001:db8:1:2:abcd::5');
    await send('2001:db8:1:3::1');
    const entries = auditEntries(test);
    for (const entry of entries) assert.match(entry.ipHash ?? '', /^[0-9a-f]{16}$/);
    // Same address (mapped or not) and same /64 coalesce; another /64 does not.
    assert.deepEqual(entries.map((entry) => entry.count).sort(), [1, 2, 2]);
    const dump = logDump(test);
    for (const raw of ['203.0.113.7', '2001:db8', '127.0.0.1']) assert.equal(dump.includes(raw), false, `${raw} is not stored`);

    assert.equal(normalizeIp('::ffff:203.0.113.7'), '203.0.113.7');
    assert.equal(normalizeIp('2001:0db8:0001:0002:0000:0000:0000:0001'), '2001:db8:1:2::/64');
    assert.equal(normalizeIp('2001:db8:1:2::1'), normalizeIp('2001:db8:1:2:ffff:ffff:ffff:ffff'));
    assert.notEqual(normalizeIp('2001:db8:1:2::1'), normalizeIp('2001:db8:1:3::1'));
    assert.equal(test.context.logs.ipHash('198.51.100.1'), test.context.logs.ipHash('::ffff:198.51.100.1'));
    assert.equal(test.context.logs.ipHash(undefined), null);
  });

  it('never stores passwords, Markdown bodies or the submitted values of failed fields', async () => {
    const test = await server();
    const weak = 'Weak-Pass';
    let response = await test.app.inject({
      method: 'POST', url: '/api/setup', headers: CSRF, payload: { setupPassword: SETUP_PASSWORD, username: 'admin', password: weak },
    });
    assert.equal(response.statusCode, 400);
    const failedSetup = auditEntries(test).find((entry) => entry.action === 'setupAdmin')!;
    assert.deepEqual(failedSetup.details, { error: 'validation_failed', failedFields: ['password'] });

    const cookie = await setupAdmin(test);
    const headers = { cookie, ...CSRF };
    const newPassword = 'Another-Strong-Password-42';
    response = await test.app.inject({
      method: 'POST', url: '/api/admin/password', headers, payload: { currentPassword: ADMIN.password, newPassword },
    });
    assert.equal(response.statusCode, 200);
    const changed = auditEntries(test).find((entry) => entry.action === 'changePassword')!;
    assert.equal(changed.outcome, 'success');
    assert.deepEqual(changed.details, {});
    const headers2 = { cookie: String(response.headers['set-cookie']).split(';')[0], ...CSRF };

    response = await test.app.inject({
      method: 'POST', url: '/api/admin/events', headers: headers2,
      payload: { ...validEvent, name: 'Ok name', portalCode: 'NOT-A-CODE-XYZZY', galaxy: '' },
    });
    assert.equal(response.statusCode, 400);
    const invalid = auditEntries(test).find((entry) => entry.action === 'createAdminEvent')!;
    assert.equal(invalid.details.error, 'validation_failed');
    assert.ok((invalid.details.failedFields as string[]).includes('portalCode'));

    response = await test.app.inject({
      method: 'POST', url: '/api/admin/events', headers: headers2,
      payload: { ...validEvent, description: 'SECRET-MARKDOWN-BODY with **bold**' },
    });
    assert.equal(response.statusCode, 201);
    const created = auditEntries(test).find((entry) => entry.action === 'createAdminEvent' && entry.outcome === 'success')!;
    assert.equal(created.targetType, 'event');
    assert.equal(created.targetId, response.json().event.id);
    assert.equal(created.details.name, validEvent.name);
    assert.ok((created.details.fields as string[]).includes('description'));

    const dump = logDump(test);
    for (const secret of [SETUP_PASSWORD, ADMIN.password, weak, newPassword, 'NOT-A-CODE-XYZZY', 'SECRET-MARKDOWN-BODY']) {
      assert.equal(dump.includes(secret), false, `${secret} is not in the logs`);
    }
  });

  it('records targets and change summaries for content, settings and submissions', async () => {
    const test = await server();
    const cookie = await setupAdmin(test);
    const headers = { cookie, ...CSRF };
    const id = (await test.app.inject({ method: 'POST', url: '/api/admin/events', headers, payload: validEvent })).json().event.id;
    await test.app.inject({ method: 'PUT', url: `/api/admin/events/${id}`, headers, payload: { ...validEvent, region: 'Elsewhere' } });
    await test.app.inject({ method: 'POST', url: `/api/admin/events/${id}/status`, headers, payload: { status: 'published' } });
    await test.app.inject({ method: 'DELETE', url: `/api/admin/events/${id}`, headers });
    const byAction = (action: string) => auditEntries(test).find((entry) => entry.action === action && entry.outcome === 'success')!;
    assert.deepEqual(byAction('updateAdminEvent').details, { name: validEvent.name, changedFields: ['region'] });
    assert.deepEqual(byAction('setAdminEventStatus').details, { name: validEvent.name, from: 'unpublished', to: 'published' });
    assert.equal(byAction('deleteAdminEvent').targetId, id);

    await test.app.inject({ method: 'PUT', url: '/api/admin/settings', headers, payload: { values: { 'site.title': 'New Title', 'logs.serverRetentionDays': 7 } } });
    assert.deepEqual(byAction('updateSettings').details, {
      changes: [
        { key: 'site.title', old: 'AGT Event Calendar', new: 'New Title' },
        { key: 'logs.serverRetentionDays', old: 30, new: 7 },
      ],
    });

    const holiday = (await test.app.inject({
      method: 'POST', url: '/api/admin/holidays', headers, payload: { name: 'Founding Day', civilization: 'AGT', date: '2020-01-01', type: 'Holiday' },
    })).json().holiday;
    assert.equal(byAction('createAdminHoliday').targetId, holiday.id);
    assert.equal(byAction('createAdminHoliday').details.name, 'Founding Day');

    const exported = await test.app.inject({ method: 'GET', url: '/api/admin/backup', headers: { cookie } });
    assert.equal(exported.statusCode, 200);
    assert.match(String(byAction('downloadBackup').details.fileName), /^agt-event-calendar-backup-/);
  });
});

describe('server log', () => {
  it('records startup, migrations and configuration warnings, but not debug lines', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'agt-startup-'));
    dirs.push(dir);
    const logMigrations: Migration[] = [];
    const migrations: Migration[] = [];
    const config = resolveConfig(parseConfigText(''), null, path.join(dir, 'config.yaml'), dir);
    const logs = LogStore.open(config.logDatabaseFile, (migration) => logMigrations.push(migration));
    const db = openDatabase(config.databaseFile, { onMigration: (migration) => migrations.push(migration) });
    const context: AppContext = { config, db, logs, setupPassword: null, version: '9.9.9', operation: new OperationLock() };
    let stdout = '';
    const sink = new Writable({ write(chunk, _encoding, done) { stdout += String(chunk); done(); } });
    try {
      const logger = createLogger(logs, 'debug', sink);
      logStartup(logger, context, { migrations, logMigrations, address: 'http://127.0.0.1:8080' });
      logger.debug('only on stdout');
      const entries = logs.listServer({}, 200).items;
      assert.equal(entries.filter((entry) => entry.source === 'migrations').length, MIGRATIONS.length + LOG_MIGRATIONS.length);
      const startup = entries.find((entry) => entry.source === 'startup')!;
      assert.equal(startup.level, 'info');
      assert.equal(startup.details.version, '9.9.9');
      assert.equal(startup.details.address, 'http://127.0.0.1:8080');
      assert.equal(startup.details.defaults, true);
      assert.ok(entries.some((entry) => entry.source === 'config' && entry.level === 'warn' && /No configuration file/.test(entry.message)));
      assert.ok(entries.some((entry) => entry.source === 'config' && /AGT_SETUP_PASSWORD is not set/.test(entry.message)));
      assert.equal(entries.some((entry) => entry.message === 'only on stdout'), false, 'debug lines are not stored');
      assert.match(stdout, /only on stdout/);
      assert.match(stdout, /started on http:\/\/127\.0\.0\.1:8080/);

      // With stdout at "warn", the log store still receives info.
      const quiet = createLogger(logs, 'warn', sink);
      quiet.info({ source: 'test' }, 'info still stored');
      assert.ok(logs.listServer({ source: 'test' }, 10).items.length === 1);
      assert.equal(stdout.includes('info still stored'), false);
    } finally {
      db.close();
      logs.close();
    }
  });

  it('stores no access logs, and links a 500 to its audit entry by request ID', async () => {
    const test = await server();
    test.app.post('/api/test/crash', { config: { writesData: false }, schema: { operationId: 'crashForTest' } }, async () => {
      throw new Error('Simulated failure');
    });
    await test.app.inject({ method: 'GET', url: '/api/events' });
    await test.app.inject({ method: 'GET', url: '/api/health' });
    const response = await test.app.inject({ method: 'POST', url: '/api/test/crash', headers: CSRF });
    assert.equal(response.statusCode, 500);
    assert.equal(response.json().message, 'An unexpected server error occurred.');

    const entries = serverEntries(test);
    assert.equal(entries.some((entry) => /incoming request|request completed/.test(entry.message)), false);
    const error = entries.find((entry) => entry.level === 'error')!;
    assert.equal(error.source, 'http');
    assert.match(error.message, /Simulated failure/);
    const details = error.details.error as { name: string; message: string; stack: string };
    assert.equal(details.message, 'Simulated failure');
    assert.match(details.stack, /Simulated failure/);
    assert.equal(error.details.route, '/api/test/crash');

    const audit = auditEntries(test).find((entry) => entry.action === 'crashForTest')!;
    assert.equal(audit.outcome, 'failure');
    assert.equal(audit.statusCode, 500);
    assert.ok(audit.requestId);
    assert.equal(error.requestId, audit.requestId);
  });

  it('counts unseen warnings and errors until the tab is opened', async () => {
    const test = await server();
    const cookie = await setupAdmin(test);
    const summary = async () => (await test.app.inject({ method: 'GET', url: '/api/admin/logs/server/summary', headers: { cookie } })).json();
    test.context.logs.writeServer({ level: 'info', source: 'test', message: 'fine' });
    test.context.logs.writeServer({ level: 'warn', source: 'test', message: 'careful' });
    test.context.logs.writeServer({ level: 'error', source: 'test', message: 'broken' });
    test.context.logs.writeServer({ level: 'fatal', source: 'test', message: 'very broken' });
    const initial = await summary();
    assert.ok(initial.unseenWarnings >= 2, 'includes the setup reminder');
    assert.equal(initial.unseenErrors, 2);

    const seen = await test.app.inject({ method: 'POST', url: '/api/admin/logs/server/seen', headers: { cookie, ...CSRF } });
    assert.equal(seen.statusCode, 200);
    assert.deepEqual(seen.json(), { unseenWarnings: 0, unseenErrors: 0 });
    assert.deepEqual(await summary(), { unseenWarnings: 0, unseenErrors: 0 });
    assert.ok(auditEntries(test).some((entry) => entry.action === 'markServerLogSeen' && entry.outcome === 'success'));

    test.context.logs.writeServer({ level: 'error', source: 'test', message: 'again' });
    assert.deepEqual(await summary(), { unseenWarnings: 0, unseenErrors: 1 });
  });

  it('can be cleared by the admin, while no route can delete audit entries', async () => {
    const test = await server();
    const cookie = await setupAdmin(test);
    test.context.logs.writeServer({ level: 'warn', source: 'test', message: 'to be cleared' });
    const before = serverEntries(test).length;
    assert.ok(before > 0);
    const auditBefore = auditEntries(test).length;

    const response = await test.app.inject({ method: 'DELETE', url: '/api/admin/logs/server', headers: { cookie, ...CSRF } });
    assert.equal(response.statusCode, 204);
    assert.equal(response.body, '');
    assert.equal(serverEntries(test).length, 0);
    const cleared = auditEntries(test).find((entry) => entry.action === 'clearServerLog')!;
    assert.equal(cleared.outcome, 'success');
    assert.equal(cleared.details.deleted, before);
    assert.equal(auditEntries(test).length, auditBefore + 1, 'the audit log is untouched');

    const writes = test.app.apiRoutes.filter((route) => route.url.startsWith('/api/admin/logs/audit') && route.method !== 'GET');
    assert.deepEqual(writes, []);
    for (const method of ['DELETE', 'PUT', 'PATCH', 'POST'] as const) {
      const attempt = await test.app.inject({ method, url: '/api/admin/logs/audit', headers: { cookie, ...CSRF } });
      assert.equal(attempt.statusCode, 404, `${method} /api/admin/logs/audit does not exist`);
    }
  });
});

describe('log API', () => {
  it('pages newest first and filters both logs', async () => {
    const test = await server();
    const cookie = await setupAdmin(test);
    for (let index = 1; index <= 5; index += 1) {
      test.context.logs.writeServer({ level: index % 2 ? 'info' : 'error', source: 'paging', message: `entry ${index}` });
    }
    const get = async (url: string) => {
      const response = await test.app.inject({ method: 'GET', url, headers: { cookie } });
      assert.equal(response.statusCode, 200, response.body);
      return response.json();
    };
    const first = await get('/api/admin/logs/server?source=paging&limit=2');
    assert.deepEqual(first.items.map((entry: { message: string }) => entry.message), ['entry 5', 'entry 4']);
    assert.ok(first.nextCursor);
    const second = await get(`/api/admin/logs/server?source=paging&limit=2&cursor=${first.nextCursor}`);
    assert.deepEqual(second.items.map((entry: { message: string }) => entry.message), ['entry 3', 'entry 2']);
    const last = await get(`/api/admin/logs/server?source=paging&limit=2&cursor=${second.nextCursor}`);
    assert.deepEqual(last.items.map((entry: { message: string }) => entry.message), ['entry 1']);
    assert.equal(last.nextCursor, null);

    const errors = await get('/api/admin/logs/server?source=paging&level=error');
    assert.deepEqual(errors.items.map((entry: { message: string }) => entry.message), ['entry 4', 'entry 2']);
    assert.equal((await get('/api/admin/logs/server?q=entry%203')).items.length, 1);
    assert.equal((await get('/api/admin/logs/server?q=%25')).items.length, 0, 'LIKE wildcards are matched literally');
    assert.equal((await get(`/api/admin/logs/server?from=${encodeURIComponent('2999-01-01T00:00:00Z')}`)).items.length, 0);
    const entry = first.items[0];
    assert.deepEqual(Object.keys(entry).sort(), ['at', 'details', 'id', 'level', 'message', 'requestId', 'source']);

    const audit = await get('/api/admin/logs/audit?action=setupAdmin&outcome=success&actorType=admin');
    assert.equal(audit.items.length, 1);
    assert.deepEqual(Object.keys(audit.items[0]).sort(), [
      'action', 'actor', 'actorType', 'at', 'client', 'count', 'details', 'id', 'ipHash', 'lastAt', 'method', 'outcome',
      'requestId', 'route', 'statusCode', 'targetId', 'targetType',
    ]);
    assert.equal((await get('/api/admin/logs/audit?q=setup')).items.length >= 1, true);
    assert.equal((await get('/api/admin/logs/audit?outcome=denied')).items.length, 0);

    for (const bad of ['cursor=nope', 'from=yesterday', 'limit=0', 'limit=201', 'level=debug']) {
      const response = await test.app.inject({ method: 'GET', url: `/api/admin/logs/server?${bad}`, headers: { cookie } });
      assert.equal(response.statusCode, 400, bad);
    }
  });

  it('records the web client header', async () => {
    const test = await server();
    await test.app.inject({ method: 'POST', url: '/api/admin/login', headers: { ...CSRF, 'x-agt-client': 'web' }, payload: { username: 'a', password: 'b' } });
    await test.app.inject({ method: 'POST', url: '/api/setup', headers: CSRF, payload: {} });
    assert.equal(auditEntries(test).find((entry) => entry.action === 'login')!.client, 'web');
    assert.equal(auditEntries(test).find((entry) => entry.action === 'setupAdmin')!.client, 'api');
  });

  it('exports JSON Lines and CSV, neutralizing spreadsheet formulas', async () => {
    assert.equal(csvCell('=1+1'), "'=1+1");
    assert.equal(csvCell('+1'), "'+1");
    assert.equal(csvCell('-1'), "'-1");
    assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
    assert.equal(csvCell('\tx'), "'\tx");
    assert.equal(csvCell('\rx'), '"\'\rx"');
    assert.equal(csvCell('a,"b"'), '"a,""b"""');
    assert.equal(csvCell(null), '');
    assert.equal(csvCell({ a: 1 }), '"{""a"":1}"');

    const test = await server();
    const cookie = await setupAdmin(test);
    test.context.logs.writeAudit(auditEntry({ actor: '=HYPERLINK("http://example.com","x")', action: 'formulaTest' }));
    test.context.logs.writeServer({ level: 'warn', source: 'test', message: '@cmd|calc' });

    const csv = await test.app.inject({ method: 'GET', url: '/api/admin/logs/audit/export?format=csv&action=formulaTest', headers: { cookie } });
    assert.equal(csv.statusCode, 200);
    assert.match(String(csv.headers['content-type']), /^text\/csv/);
    assert.match(String(csv.headers['content-disposition']), /attachment; filename="agt-event-calendar-audit-log-\d{4}-\d{2}-\d{2}T[\d-]+Z\.csv"/);
    const lines = csv.body.trim().split('\r\n');
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^id,at,lastAt,count,actorType,actor,/);
    assert.ok(lines[1].includes('"\'=HYPERLINK(""http://example.com"",""x"")"'), lines[1]);

    const serverCsv = await test.app.inject({ method: 'GET', url: '/api/admin/logs/server/export?format=csv&source=test', headers: { cookie } });
    assert.ok(serverCsv.body.includes(",'@cmd|calc,"));

    const jsonl = await test.app.inject({ method: 'GET', url: '/api/admin/logs/server/export', headers: { cookie } });
    assert.equal(jsonl.statusCode, 200);
    assert.match(String(jsonl.headers['content-type']), /^application\/x-ndjson/);
    assert.match(String(jsonl.headers['content-disposition']), /agt-event-calendar-server-log-.*\.jsonl"/);
    const records = jsonl.body.trim().split('\n').map((line) => JSON.parse(line));
    assert.ok(records.some((record) => record.message === '@cmd|calc'));

    const exports = auditEntries(test).filter((entry) => entry.action === 'exportAuditLog' || entry.action === 'exportServerLog');
    assert.equal(exports.length, 3, 'every export is audited');
    assert.deepEqual(exports.find((entry) => entry.action === 'exportAuditLog')!.details, { format: 'csv', filters: { action: 'formulaTest' } });
  });
});

describe('log retention', () => {
  it('deletes by age, then by cap, removing failed audit entries first', async () => {
    const test = await server();
    const { logs } = test.context;
    const old = new Date(Date.now() - 400 * 86_400_000).toISOString();
    logs.writeServer({ level: 'info', source: 'test', message: 'ancient', at: old });
    logs.writeAudit(auditEntry({ action: 'ancient', at: old }));
    logs.writeServer({ level: 'info', source: 'test', message: 'recent' });

    const result = runRetention(test.context, test.app.log)!;
    assert.equal(result.server.byAge, 1);
    assert.equal(result.audit.byAge, 1);
    assert.equal(logs.listAudit({ action: 'ancient' }, 10).items.length, 0);
    assert.equal(logs.listServer({ q: 'ancient' }, 10).items.length, 0);
    const recorded = logs.listServer({ source: 'retention' }, 10).items;
    assert.equal(recorded.length, 1, 'a run that deletes something is recorded');
    assert.match(recorded[0].message, /deleted 2 entries/);
    assert.equal(runRetention(test.context, test.app.log)!.server.byAge, 0);
    assert.equal(logs.listServer({ source: 'retention' }, 10).items.length, 1, 'a run that deletes nothing is not recorded');

    logs.db.prepare('DELETE FROM audit_log').run();
    for (let index = 1; index <= 3; index += 1) {
      logs.writeAudit(auditEntry({ action: `ok${index}` }));
      logs.writeAudit(auditEntry({ action: `failed${index}`, outcome: 'failure', statusCode: 400 }));
    }
    const limits = { serverRetentionDays: 30, serverMaxEntries: 1, auditRetentionDays: 365, auditMaxEntries: 4 };
    let capped = logs.applyRetention(limits);
    assert.equal(capped.audit.byCap, 2);
    assert.deepEqual(logs.listAudit({}, 10).items.map((entry) => entry.action), ['failed3', 'ok3', 'ok2', 'ok1']);
    assert.equal(logs.listServer({}, 10).items.length, 1);
    assert.equal(logs.listServer({}, 10).items[0].source, 'retention', 'the newest server entries are kept');

    capped = logs.applyRetention({ ...limits, auditMaxEntries: 2 });
    assert.equal(capped.audit.byCap, 2);
    assert.deepEqual(logs.listAudit({}, 10).items.map((entry) => entry.action), ['ok3', 'ok2']);
  });

  it('enforces the 30-day minimum for the audit log', async () => {
    assert.throws(() => parseConfigText('logs:\n  auditRetentionDays: 29\n'), /logs\.auditRetentionDays/);
    assert.doesNotThrow(() => parseConfigText('logs:\n  auditRetentionDays: 30\n  serverRetentionDays: 1\n'));
    const test = await server();
    const cookie = await setupAdmin(test);
    const set = (values: Record<string, unknown>) =>
      test.app.inject({ method: 'PUT', url: '/api/admin/settings', headers: { cookie, ...CSRF }, payload: { values } });
    const rejected = await set({ 'logs.auditRetentionDays': 29 });
    assert.equal(rejected.statusCode, 400);
    assert.equal(rejected.json().error, 'invalid_setting');
    assert.equal((await set({ 'logs.serverMaxEntries': 999 })).statusCode, 400);
    assert.equal((await set({ 'logs.auditRetentionDays': 30 })).statusCode, 200);
  });
});

describe('logs and backups', () => {
  it('keeps log data out of backups and keeps both logs across a restore', async () => {
    const test = await server();
    let cookie = await setupAdmin(test);
    test.context.logs.writeServer({ level: 'warn', source: 'test', message: 'survives the restore' });
    await test.app.inject({ method: 'POST', url: '/api/admin/events', headers: { cookie, ...CSRF }, payload: validEvent });

    const backup = await test.app.inject({ method: 'GET', url: '/api/admin/backup', headers: { cookie } });
    assert.equal(backup.statusCode, 200);
    const zipPath = path.join(test.dir, 'backup.zip');
    writeFileSync(zipPath, backup.rawPayload);
    const zip = await openSafeZip(zipPath, { maxEntries: 1000, maxUncompressedBytes: 1e9 });
    const names = zip.entries.map((entry) => entry.name);
    const database = await zip.read(zip.entries.find((entry) => entry.name === 'database.sqlite')!);
    zip.close();
    assert.equal(names.some((name) => /log/i.test(name)), false, `no log files in ${names.join(', ')}`);
    const snapshotPath = path.join(test.dir, 'snapshot.sqlite');
    writeFileSync(snapshotPath, database);
    const snapshot = new Database(snapshotPath, { readonly: true });
    const tables = (snapshot.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((row) => row.name);
    snapshot.close();
    assert.equal(tables.some((name) => /log/.test(name) && name !== 'changelog'), false, `no log tables in ${tables.join(', ')}`);

    const auditBefore = auditEntries(test).map((entry) => entry.id);
    const serverBefore = serverEntries(test).map((entry) => entry.id);
    const body = multipart({ action: 'restore' }, [{ name: 'backup', fileName: 'backup.zip', contentType: 'application/zip', data: backup.rawPayload }]);
    const restored = await test.app.inject({
      method: 'POST', url: '/api/admin/restore', payload: body.payload, headers: { cookie, ...CSRF, ...body.headers },
    });
    assert.equal(restored.statusCode, 200, restored.body);

    const auditAfter = auditEntries(test);
    for (const id of auditBefore) assert.ok(auditAfter.some((entry) => entry.id === id), 'earlier audit entries are kept');
    const serverAfter = serverEntries(test).map((entry) => entry.id);
    for (const id of serverBefore) assert.ok(serverAfter.includes(id), 'earlier server log entries are kept');
    const restore = auditAfter.find((entry) => entry.action === 'restoreBackup' && entry.outcome === 'success')!;
    assert.equal(restore.actorType, 'admin');
    assert.equal(restore.actor, ADMIN.username);
    assert.equal(restore.details.action, 'restore');
    assert.deepEqual(restore.details.counts, { events: 1, holidays: 0, changelog: 0, images: 0 });
    assert.ok(restore.details.preRestoreBackup);

    // The restored instance keeps writing to the same log store.
    cookie = String((await test.app.inject({ method: 'POST', url: '/api/admin/login', headers: CSRF, payload: ADMIN })).headers['set-cookie']).split(';')[0];
    assert.ok(cookie);
    assert.equal(auditEntries(test).filter((entry) => entry.action === 'login' && entry.outcome === 'success').length, 1);
  });
});
