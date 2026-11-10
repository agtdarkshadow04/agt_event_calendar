import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { ADMIN, CSRF, SETUP_PASSWORD, cookieFrom, createTestServer, setupAdmin } from './helpers';
import type { TestServer } from './helpers';

const servers: TestServer[] = [];
after(async () => { for (const server of servers) await server.close(); });
async function server(options?: Parameters<typeof createTestServer>[0]) {
  const created = await createTestServer(options);
  servers.push(created);
  return created;
}

describe('first-run setup with AGT_SETUP_PASSWORD', () => {
  it('refuses setup with a clear message when the variable is unset', async () => {
    const { app } = await server({ setupPassword: null });
    const status = await app.inject({ method: 'GET', url: '/api/setup/status' });
    assert.deepEqual(status.json(), { adminExists: false, setupPasswordConfigured: false });
    const response = await app.inject({ method: 'POST', url: '/api/setup', headers: CSRF, payload: { setupPassword: '', ...ADMIN } });
    assert.equal(response.statusCode, 503);
    assert.match(response.json().message, /AGT_SETUP_PASSWORD is not set.*restart/);
  });

  it('requires the setup password, a new admin password, and the CSRF header', async () => {
    const { app } = await server();
    const wrong = await app.inject({ method: 'POST', url: '/api/setup', headers: CSRF, payload: { setupPassword: 'nope', ...ADMIN } });
    assert.equal(wrong.statusCode, 401);
    const reused = await app.inject({
      method: 'POST', url: '/api/setup', headers: CSRF,
      payload: { setupPassword: SETUP_PASSWORD, username: 'admin', password: SETUP_PASSWORD },
    });
    assert.equal(reused.statusCode, 400);
    assert.match(reused.json().message, /setup password cannot be reused/);
    const short = await app.inject({
      method: 'POST', url: '/api/setup', headers: CSRF,
      payload: { setupPassword: SETUP_PASSWORD, username: 'admin', password: 'short' },
    });
    assert.equal(short.statusCode, 400);
    const noCsrf = await app.inject({ method: 'POST', url: '/api/setup', payload: { setupPassword: SETUP_PASSWORD, ...ADMIN } });
    assert.equal(noCsrf.statusCode, 403);
  });

  it('creates exactly one admin, stores only a salted hash, then disables setup permanently', async () => {
    const test = await server();
    const cookie = await setupAdmin(test);
    assert.match(cookie, /^agt_session=/);

    const row = test.context.db.prepare('SELECT username, password_hash FROM admin').all() as { username: string; password_hash: string }[];
    assert.equal(row.length, 1);
    assert.match(row[0].password_hash, /^scrypt\$\d+\$\d+\$\d+\$[^$]+\$[^$]+$/);
    assert.equal(row[0].password_hash.includes(ADMIN.password), false);

    const again = await test.app.inject({
      method: 'POST', url: '/api/setup', headers: CSRF,
      payload: { setupPassword: SETUP_PASSWORD, username: 'other', password: 'another long password' },
    });
    assert.equal(again.statusCode, 410);
    assert.equal((test.context.db.prepare('SELECT count(*) AS n FROM admin').get() as { n: number }).n, 1);

    const session = await test.app.inject({ method: 'GET', url: '/api/admin/session', headers: { cookie } });
    assert.equal(session.statusCode, 200);
    assert.equal(session.json().setupPasswordStillSet, true, 'dashboard recommends removing the variable');
  });

  it('ignores the setup password once the admin exists, even when the variable is unset later', async () => {
    const test = await server();
    await setupAdmin(test);
    test.context.setupPassword = null;
    const response = await test.app.inject({
      method: 'POST', url: '/api/setup', headers: CSRF,
      payload: { setupPassword: SETUP_PASSWORD, ...ADMIN },
    });
    assert.equal(response.statusCode, 410);
    const status = await test.app.inject({ method: 'GET', url: '/api/setup/status' });
    assert.equal(status.json().adminExists, true);
  });

  it('rate limits setup attempts', async () => {
    const { app } = await server({ config: 'rateLimits:\n  setup:\n    max: 2\n' });
    const attempt = () => app.inject({ method: 'POST', url: '/api/setup', headers: CSRF, payload: { setupPassword: 'x', ...ADMIN } });
    assert.equal((await attempt()).statusCode, 401);
    assert.equal((await attempt()).statusCode, 401);
    assert.equal((await attempt()).statusCode, 429);
  });
});

describe('admin sessions', () => {
  it('logs in, rejects bad credentials, logs out and rate limits logins', async () => {
    const test = await server({ config: 'rateLimits:\n  login:\n    max: 4\n' });
    await setupAdmin(test);
    const login = (password: string) => test.app.inject({
      method: 'POST', url: '/api/admin/login', headers: CSRF, payload: { username: ADMIN.username, password },
    });
    assert.equal((await login('wrong password')).statusCode, 401);
    const ok = await login(ADMIN.password);
    assert.equal(ok.statusCode, 200);
    const cookie = cookieFrom(ok);
    assert.match(String(ok.headers['set-cookie']), /HttpOnly/);
    assert.match(String(ok.headers['set-cookie']), /SameSite=Strict/);

    const unauthenticated = await test.app.inject({ method: 'GET', url: '/api/admin/events' });
    assert.equal(unauthenticated.statusCode, 401);
    assert.equal((await test.app.inject({ method: 'GET', url: '/api/admin/events', headers: { cookie } })).statusCode, 200);

    const noCsrf = await test.app.inject({ method: 'POST', url: '/api/admin/events', headers: { cookie }, payload: {} });
    assert.equal(noCsrf.statusCode, 403);

    await test.app.inject({ method: 'POST', url: '/api/admin/logout', headers: { cookie, ...CSRF } });
    assert.equal((await test.app.inject({ method: 'GET', url: '/api/admin/events', headers: { cookie } })).statusCode, 401);

    assert.equal((await login('wrong')).statusCode, 401);
    assert.equal((await login('wrong')).statusCode, 401);
    assert.equal((await login(ADMIN.password)).statusCode, 429);
  });

  it('marks the cookie Secure behind a trusted TLS-terminating proxy, and ignores the header otherwise (TEST-8)', async () => {
    const viaProxy = { ...CSRF, 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.5' };
    // The proxy connects from 127.0.0.1, the address set in server.trustProxy.
    const trusted = await server({ config: 'server:\n  trustProxy: 127.0.0.1\n' });
    const setup = await trusted.app.inject({
      method: 'POST', url: '/api/setup', headers: viaProxy, payload: { setupPassword: SETUP_PASSWORD, ...ADMIN }, remoteAddress: '127.0.0.1',
    });
    assert.equal(setup.statusCode, 201);
    assert.match(String(setup.headers['set-cookie']), /; Secure/);
    const login = await trusted.app.inject({ method: 'POST', url: '/api/admin/login', headers: viaProxy, payload: ADMIN, remoteAddress: '127.0.0.1' });
    assert.match(String(login.headers['set-cookie']), /; Secure/);

    // Without trustProxy, X-Forwarded-Proto is ignored: the request is plain HTTP.
    const direct = await server();
    const response = await direct.app.inject({
      method: 'POST', url: '/api/setup', headers: viaProxy, payload: { setupPassword: SETUP_PASSWORD, ...ADMIN }, remoteAddress: '127.0.0.1',
    });
    assert.equal(response.statusCode, 201);
    assert.doesNotMatch(String(response.headers['set-cookie']), /Secure/);
  });

  it('rejects and purges expired sessions', async () => {
    const test = await server();
    const cookie = await setupAdmin(test);
    assert.equal((await test.app.inject({ method: 'GET', url: '/api/admin/session', headers: { cookie } })).statusCode, 200);
    test.context.db.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    const expired = await test.app.inject({ method: 'GET', url: '/api/admin/session', headers: { cookie } });
    assert.equal(expired.statusCode, 401);
    assert.equal(expired.json().error, 'unauthorized');
    await test.app.inject({ method: 'POST', url: '/api/admin/login', headers: CSRF, payload: ADMIN });
    const left = test.context.db.prepare("SELECT count(*) AS n FROM sessions WHERE expires_at < '2001-01-01'").get() as { n: number };
    assert.equal(left.n, 0, 'expired sessions are deleted when a new session starts');
  });

  it('changes the password and ends other sessions', async () => {
    const test = await server();
    const first = await setupAdmin(test);
    const second = cookieFrom(await test.app.inject({
      method: 'POST', url: '/api/admin/login', headers: CSRF, payload: ADMIN,
    }));
    const change = await test.app.inject({
      method: 'POST', url: '/api/admin/password', headers: { cookie: second, ...CSRF },
      payload: { currentPassword: ADMIN.password, newPassword: 'a brand new long password' },
    });
    assert.equal(change.statusCode, 200);
    assert.equal((await test.app.inject({ method: 'GET', url: '/api/admin/session', headers: { cookie: first } })).statusCode, 401);
    assert.equal((await test.app.inject({ method: 'GET', url: '/api/admin/session', headers: { cookie: cookieFrom(change) } })).statusCode, 200);
    const oldLogin = await test.app.inject({ method: 'POST', url: '/api/admin/login', headers: CSRF, payload: ADMIN });
    assert.equal(oldLogin.statusCode, 401);
  });
});
