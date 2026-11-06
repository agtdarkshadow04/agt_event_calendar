import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { insertEvent } from '../repository';
import { CONTENT_SECURITY_POLICY } from '../app';
import { CSRF, createTestServer, setupAdmin, validEvent } from './helpers';
import type { TestServer } from './helpers';

const servers: TestServer[] = [];
after(async () => { for (const server of servers) await server.close(); });
async function adminServer(config?: string) {
  const server = await createTestServer({ config });
  servers.push(server);
  const cookie = await setupAdmin(server);
  const headers = { cookie, ...CSRF };
  return { ...server, headers };
}

describe('events API', () => {
  it('creates events with UUIDv4 IDs and returns only published ones publicly', async () => {
    const { app, headers } = await adminServer();
    const created = await app.inject({ method: 'POST', url: '/api/admin/events', headers, payload: validEvent });
    assert.equal(created.statusCode, 201);
    const event = created.json().event;
    assert.match(event.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(event.status, 'unpublished');
    assert.equal(event.legacyId, null);
    assert.deepEqual((await app.inject({ method: 'GET', url: '/api/events' })).json(), []);

    const published = await app.inject({
      method: 'POST', url: `/api/admin/events/${event.id}/status`, headers, payload: { status: 'published' },
    });
    assert.equal(published.statusCode, 200);
    const list = (await app.inject({ method: 'GET', url: '/api/events' })).json();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, event.id);
    assert.equal('status' in list[0], false);
    assert.equal('submitterAgtUsername' in list[0], false);

    const updated = await app.inject({
      method: 'PUT', url: `/api/admin/events/${event.id}`, headers, payload: { ...validEvent, name: 'Renamed' },
    });
    assert.equal(updated.json().event.name, 'Renamed');
    assert.equal(updated.json().event.status, 'published');
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/admin/events/${event.id}`, headers })).statusCode, 200);
    assert.deepEqual((await app.inject({ method: 'GET', url: '/api/events' })).json(), []);
  });

  it('validates events with the shared rules', async () => {
    const { app, headers } = await adminServer();
    const response = await app.inject({
      method: 'POST', url: '/api/admin/events', headers, payload: { ...validEvent, portalCode: 'short', start: '2030-01-01T18:00' },
    });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json().fields.map((field: { field: string }) => field.field).sort(), ['portalCode', 'start']);
    const badCover = await app.inject({
      method: 'POST', url: '/api/admin/events', headers, payload: { ...validEvent, coverImageId: '3f2b8c1e-9d4a-4f6b-8a2c-1e5d7f9b0a3c' },
    });
    assert.equal(badCover.statusCode, 400);
  });

  it('resolves legacy 4-hex IDs to the migrated event and never reissues them', async () => {
    const { app, context } = await adminServer();
    const id = insertEvent(context.db, {
      ...validEvent, end: null, civilization: null, description: null, planet: null, start: '2030-01-01T18:00:00.000Z',
    }, { status: 'published', legacyId: '8000' });
    const byLegacy = await app.inject({ method: 'GET', url: '/api/events/8000' });
    assert.equal(byLegacy.statusCode, 200);
    assert.equal(byLegacy.json().id, id);
    assert.equal(byLegacy.json().legacyId, '8000');
    assert.equal((await app.inject({ method: 'GET', url: '/api/events/abcd' })).statusCode, 404);
    assert.equal((await app.inject({ method: 'GET', url: `/api/events/${id.toUpperCase()}` })).json().id, id);
    assert.equal((await app.inject({ method: 'GET', url: '/api/events/not-an-id' })).statusCode, 404);
    assert.throws(() => insertEvent(context.db, {
      ...validEvent, end: null, civilization: null, description: null, planet: null,
    }, { status: 'published', legacyId: '8000' }), /UNIQUE/);
  });
});

describe('holidays and change log', () => {
  it('manages holidays and only returns published ones', async () => {
    const { app, headers } = await adminServer();
    const holiday = { name: 'Founding Day', civilization: 'AGT', date: '2018-12-05', type: 'Anniversary' };
    const created = await app.inject({ method: 'POST', url: '/api/admin/holidays', headers, payload: { ...holiday, published: false } });
    assert.equal(created.statusCode, 201);
    assert.deepEqual((await app.inject({ method: 'GET', url: '/api/holidays' })).json(), []);
    const { id } = created.json();
    await app.inject({ method: 'PUT', url: `/api/admin/holidays/${id}`, headers, payload: { ...holiday, published: true } });
    assert.equal((await app.inject({ method: 'GET', url: '/api/holidays' })).json()[0].name, 'Founding Day');
    const invalid = await app.inject({ method: 'POST', url: '/api/admin/holidays', headers, payload: { ...holiday, date: '2025-02-29' } });
    assert.equal(invalid.statusCode, 400);
  });

  it('manages change-log entries (Date + Changes)', async () => {
    const { app, headers } = await adminServer();
    const created = await app.inject({
      method: 'POST', url: '/api/admin/changelog', headers, payload: { date: '2026-11-01', changes: 'Self-hosting, SQLite' },
    });
    assert.equal(created.statusCode, 201);
    const list = (await app.inject({ method: 'GET', url: '/api/changelog' })).json();
    assert.deepEqual(list.map((entry: { date: string; changes: string }) => [entry.date, entry.changes]), [['2026-11-01', 'Self-hosting, SQLite']]);
    await app.inject({ method: 'PUT', url: `/api/admin/changelog/${created.json().id}`, headers, payload: { date: '2026-11-01', changes: 'x', published: false } });
    assert.deepEqual((await app.inject({ method: 'GET', url: '/api/changelog' })).json(), []);
  });
});

describe('settings precedence', () => {
  it('lets the dashboard change settings that the config file does not define', async () => {
    const { app, headers } = await adminServer();
    const response = await app.inject({
      method: 'PUT', url: '/api/admin/settings', headers, payload: { values: { 'site.title': 'My Calendar', 'submissions.enabled': false } },
    });
    assert.equal(response.statusCode, 200);
    const publicSettings = (await app.inject({ method: 'GET', url: '/api/settings/public' })).json();
    assert.equal(publicSettings.siteTitle, 'My Calendar');
    assert.equal(publicSettings.submissionsEnabled, false);
    await app.inject({ method: 'PUT', url: '/api/admin/settings', headers, payload: { values: { 'site.title': null } } });
    assert.equal((await app.inject({ method: 'GET', url: '/api/settings/public' })).json().siteTitle, 'AGT Event Calendar');
  });

  it('rejects changes to parameters defined in config.yaml with a descriptive 409', async () => {
    const { app, headers, context } = await adminServer('submissions:\n  enabled: false\nsite:\n  title: From Config\n');
    const states = (await app.inject({ method: 'GET', url: '/api/admin/settings', headers })).json();
    const enabled = states.find((state: { key: string }) => state.key === 'submissions.enabled');
    assert.deepEqual([enabled.value, enabled.source, enabled.locked], [false, 'config', true]);

    const response = await app.inject({
      method: 'PUT', url: '/api/admin/settings', headers, payload: { values: { 'site.supportUrl': 'https://example.com', 'submissions.enabled': true } },
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().message, 'submissions.enabled is defined in the configuration file and cannot be changed from the dashboard.');
    assert.equal(context.db.prepare('SELECT count(*) AS n FROM settings').get().n, 0, 'nothing is written when one key is locked');

    context.db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('site.title', '\"From DB\"', 'now')").run();
    assert.equal((await app.inject({ method: 'GET', url: '/api/settings/public' })).json().siteTitle, 'From Config');
  });

  it('validates setting values and rejects unknown keys', async () => {
    const { app, headers } = await adminServer();
    const invalid = await app.inject({ method: 'PUT', url: '/api/admin/settings', headers, payload: { values: { 'uploads.maxImageBytes': 20 * 1024 * 1024 } } });
    assert.equal(invalid.statusCode, 400);
    const unknown = await app.inject({ method: 'PUT', url: '/api/admin/settings', headers, payload: { values: { 'server.port': 1 } } });
    assert.equal(unknown.statusCode, 400);
  });
});

describe('security headers', () => {
  it('sends a CSP limiting scripts to the app origin, plus nosniff and no-store', async () => {
    const server = await createTestServer();
    servers.push(server);
    const response = await server.app.inject({ method: 'GET', url: '/api/events' });
    const csp = String(response.headers['content-security-policy']);
    assert.equal(csp, CONTENT_SECURITY_POLICY);
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /img-src 'self' https: http:/);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.match(String(response.headers['cache-control']), /no-store/);
    const health = await server.app.inject({ method: 'GET', url: '/api/health' });
    assert.deepEqual(health.json(), { status: 'ok' });
  });
});
