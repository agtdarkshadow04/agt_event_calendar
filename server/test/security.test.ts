import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { createChallenge, solveChallenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/sha';
import { DEFAULT_HOST, parseConfigText, resolveConfig } from '../config';
import type { AppContext } from '../context';
import { OperationLock } from '../dataWrite';
import { openDatabase } from '../db';
import { isLoopbackAddress } from '../http';
import { LogStore, createLogger } from '../logs';
import { hashPassword, parseStoredHash, verifyPassword } from '../passwords';
import { getSecret } from '../repository';
import { logStartup, readSetupPassword } from '../startup';
import { ADMIN, CSRF, SETUP_PASSWORD, createTestServer, multipart, setupAdmin } from './helpers';
import type { TestServer } from './helpers';

// Security, authentication and configuration rules of the AGT web app spec (AUTH-2, AUTH-3, AUTH-5, SEC-4, ALT-2).

const servers: TestServer[] = [];
after(async () => { for (const server of servers) await server.close(); });
async function server(options?: Parameters<typeof createTestServer>[0]) {
  const created = await createTestServer(options);
  servers.push(created);
  return created;
}

const serverLog = (test: TestServer) => test.context.logs.listServer({}, 500).items;
const SALT = Buffer.alloc(16, 1).toString('base64');
const KEY = Buffer.alloc(64, 2).toString('base64');

describe('listen address (SEC-4, CFG-2)', () => {
  const resolve = (text: string, env: NodeJS.ProcessEnv) => resolveConfig(parseConfigText(text), text || null, 'config.yaml', tmpdir(), env).host;

  it('defaults to loopback, then AGT_SERVER_HOST, and config.yaml wins over both', () => {
    assert.equal(DEFAULT_HOST, '127.0.0.1');
    assert.equal(resolve('', {}), '127.0.0.1');
    assert.equal(resolve('', { AGT_SERVER_HOST: '' }), '127.0.0.1');
    assert.equal(resolve('', { AGT_SERVER_HOST: '0.0.0.0' }), '0.0.0.0');
    assert.equal(resolve('server:\n  host: 192.0.2.10\n', { AGT_SERVER_HOST: '0.0.0.0' }), '192.0.2.10');
  });
});

describe('password hashes (AUTH-2)', () => {
  it('hashes with the fixed profile and verifies', async () => {
    const hash = await hashPassword(ADMIN.password);
    assert.match(hash, /^scrypt\$32768\$8\$1\$[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{86}==$/);
    assert.equal(await verifyPassword(ADMIN.password, hash), 'match');
    assert.equal(await verifyPassword('wrong password!', hash), 'mismatch');
  });

  it('rejects hostile and malformed stored hashes without calling scrypt', async () => {
    const hostile = [
      '',
      'not a hash',
      `bcrypt$32768$8$1$${SALT}$${KEY}`,
      `scrypt$32768$8$1$${SALT}`,
      `scrypt$32768$8$1$${SALT}$${KEY}$extra`,
      // Parameters that would take minutes, gigabytes, or throw if passed to scrypt.
      `scrypt$1099511627776$8$1$${SALT}$${KEY}`,
      `scrypt$32768$1024$1$${SALT}$${KEY}`,
      `scrypt$32768$8$64$${SALT}$${KEY}`,
      `scrypt$16384$8$1$${SALT}$${KEY}`,
      // Not plain decimal.
      `scrypt$032768$8$1$${SALT}$${KEY}`,
      `scrypt$+32768$8$1$${SALT}$${KEY}`,
      `scrypt$32768.0$8$1$${SALT}$${KEY}`,
      `scrypt$0x8000$8$1$${SALT}$${KEY}`,
      `scrypt$32768$08$1$${SALT}$${KEY}`,
      // Wrong salt or key length, or not standard base64.
      `scrypt$32768$8$1$${Buffer.alloc(8).toString('base64')}$${KEY}`,
      `scrypt$32768$8$1$${SALT}$${Buffer.alloc(1024).toString('base64')}`,
      `scrypt$32768$8$1$${SALT}$${Buffer.alloc(0).toString('base64')}`,
      `scrypt$32768$8$1$${Buffer.alloc(16, 255).toString('base64url')}$${KEY}`,
      `scrypt$32768$8$1$${SALT.replace(/=+$/, '')}$${KEY}`,
      `scrypt$32768$8$1$${SALT}$${KEY.slice(0, -4)}!!!!`,
    ];
    for (const stored of hostile) {
      assert.equal(parseStoredHash(stored), null, stored);
      const started = performance.now();
      assert.equal(await verifyPassword(ADMIN.password, stored), 'unsupported', stored);
      // scrypt with the supported profile alone takes tens of milliseconds.
      assert.ok(performance.now() - started < 20, `${stored} was rejected without scrypt`);
    }
    assert.notEqual(parseStoredHash(`scrypt$32768$8$1$${SALT}$${KEY}`), null);
  });

  it('answers a malformed stored hash like a wrong password and logs an error without the hash', async () => {
    const test = await server();
    const cookie = await setupAdmin(test);
    const hostile = `scrypt$1099511627776$8$1$${SALT}$${KEY}`;
    test.context.db.prepare('UPDATE admin SET password_hash = ?').run(hostile);

    const login = await test.app.inject({ method: 'POST', url: '/api/admin/login', headers: CSRF, payload: ADMIN });
    assert.equal(login.statusCode, 401);
    assert.equal(login.json().error, 'invalid_credentials');
    const change = await test.app.inject({
      method: 'POST', url: '/api/admin/password', headers: { cookie, ...CSRF },
      payload: { currentPassword: ADMIN.password, newPassword: 'another long password' },
    });
    assert.equal(change.statusCode, 401);
    assert.equal(change.json().error, 'invalid_credentials');

    const errors = serverLog(test).filter((entry) => entry.source === 'auth' && entry.level === 'error');
    assert.equal(errors.length, 2);
    assert.match(errors[0].message, /malformed or uses unsupported scrypt parameters/);
    assert.equal(JSON.stringify(serverLog(test)).includes(SALT), false, 'the hash is never logged');
  });
});

describe('setup password and username (AUTH-3, AUTH-5)', () => {
  it('stops startup for a setup password longer than 1024 characters while no admin exists', () => {
    const long = 'x'.repeat(1025);
    assert.match(readSetupPassword(long, false).error ?? '', /AGT_SETUP_PASSWORD is longer than 1024 characters/);
    assert.equal(readSetupPassword(long, true).error, null, 'only warned about once the admin exists');
    assert.equal(readSetupPassword('x'.repeat(1024), false).error, null);
    // Characters are Unicode code points: 1024 emoji are 2048 UTF-16 code units.
    assert.equal(readSetupPassword('😀'.repeat(1024), false).error, null);
    assert.notEqual(readSetupPassword('😀'.repeat(1025), false).error, null);
    // Measured as read from the environment, before trimming.
    assert.notEqual(readSetupPassword(` ${'x'.repeat(1024)}`, false).error, null);
    assert.deepEqual(readSetupPassword('   ', false), { value: null, error: null });
    assert.deepEqual(readSetupPassword(undefined, false), { value: null, error: null });
    assert.deepEqual(readSetupPassword(`  ${SETUP_PASSWORD} `, false), { value: SETUP_PASSWORD, error: null });
  });

  it('requires a trimmed username of 1–64 characters and caps request fields', async () => {
    const test = await server();
    const setup = (payload: Record<string, unknown>) => test.app.inject({
      method: 'POST', url: '/api/setup', headers: CSRF, payload: { setupPassword: SETUP_PASSWORD, ...ADMIN, ...payload },
    });
    const empty = await setup({ username: '   ' });
    assert.equal(empty.statusCode, 400);
    assert.equal(empty.json().error, 'validation_failed');
    // Rejected by the request schema (AUTH-5), before the handler runs.
    for (const payload of [{ username: 'a'.repeat(65) }, { setupPassword: 'x'.repeat(1025) }, { password: 'x'.repeat(1025) }]) {
      const response = await setup(payload);
      assert.equal(response.statusCode, 400, JSON.stringify(payload).slice(0, 40));
    }
    const login = await test.app.inject({
      method: 'POST', url: '/api/admin/login', headers: CSRF, payload: { username: 'a'.repeat(65), password: ADMIN.password },
    });
    assert.equal(login.statusCode, 400);

    // 64 code points as sent (65 UTF-16 code units), 63 after trimming.
    const username = ` ${'a'.repeat(62)}😀`;
    const created = await setup({ username });
    assert.equal(created.statusCode, 201, created.body);
    assert.equal(created.json().username, username.trim(), 'stored as entered after trimming');
  });
});

describe('plain HTTP warning (SEC-4)', () => {
  const warnings = (test: TestServer) => serverLog(test).filter((entry) => entry.source === 'security');

  it('warns once per process when credentials arrive over plain HTTP from another host', async () => {
    const test = await server();
    await setupAdmin(test);
    await test.app.inject({ method: 'POST', url: '/api/admin/login', headers: CSRF, payload: ADMIN });
    assert.equal(warnings(test).length, 0, 'loopback requests are fine');

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await test.app.inject({ method: 'POST', url: '/api/admin/login', headers: CSRF, payload: ADMIN, remoteAddress: '203.0.113.5' });
    }
    assert.equal(warnings(test).length, 1);
    assert.equal(warnings(test)[0].level, 'warn');
    assert.match(warnings(test)[0].message, /plain HTTP.*TLS/);
  });

  it('does not warn behind a trusted TLS proxy', async () => {
    const test = await server({ config: 'server:\n  trustProxy: true\n' });
    await test.app.inject({
      method: 'POST', url: '/api/setup', headers: { ...CSRF, 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.5' },
      payload: { setupPassword: SETUP_PASSWORD, ...ADMIN }, remoteAddress: '127.0.0.1',
    });
    assert.equal(warnings(test).length, 0);
  });

  it('recognizes loopback addresses', () => {
    for (const ip of ['127.0.0.1', '127.8.9.10', '::1', '::ffff:127.0.0.1', '0:0:0:0:0:0:0:1']) assert.ok(isLoopbackAddress(ip), ip);
    for (const ip of ['203.0.113.5', '::ffff:203.0.113.5', '10.0.0.1', '::', 'fe80::1', '']) assert.equal(isLoopbackAddress(ip), false, ip);
  });
});

describe('ALTCHA key (ALT-2, SEC-8)', () => {
  it('is generated at startup, and requests only read it', async () => {
    const test = await server();
    const key = getSecret(test.context.db, 'altcha_hmac_key');
    assert.match(key ?? '', /^[0-9a-f]{64}$/);
    const response = await test.app.inject({ method: 'GET', url: '/api/altcha/challenge' });
    assert.equal(response.statusCode, 200);
    assert.equal(getSecret(test.context.db, 'altcha_hmac_key'), key);
  });

  it('ignores the deprecated altcha.hmacKey and warns at startup', async () => {
    const configured = 'a-test-hmac-key-that-is-at-least-32-characters-long';
    // createTestServer() already opens an `altcha:` block; this line extends it.
    const test = await server({ config: `  hmacKey: ${configured}\n` });
    assert.notEqual(getSecret(test.context.db, 'altcha_hmac_key'), configured);

    // A challenge signed with the configured key is not accepted.
    const challenge = await createChallenge({
      algorithm: 'SHA-256', cost: 1000, deriveKey, hmacSignatureSecret: configured, expiresAt: Math.floor(Date.now() / 1000) + 60,
    });
    const solution = await solveChallenge({ challenge, deriveKey });
    const altcha = Buffer.from(JSON.stringify({ challenge, solution })).toString('base64');
    const form = multipart({ altcha });
    const response = await test.app.inject({ method: 'POST', url: '/api/submissions', headers: { ...CSRF, ...form.headers }, payload: form.payload });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, 'captcha_failed');

    const dir = mkdtempSync(path.join(tmpdir(), 'agt-hmac-'));
    try {
      const config = resolveConfig(parseConfigText(`altcha:\n  hmacKey: ${configured}\n`), 'x', path.join(dir, 'config.yaml'), dir);
      const context: AppContext = {
        config, db: openDatabase(config.databaseFile), logs: LogStore.open(config.logDatabaseFile), setupPassword: null, version: 'test',
        operation: new OperationLock(),
      };
      logStartup(createLogger(context.logs, 'silent', null), context, { migrations: [], logMigrations: [], address: 'http://127.0.0.1:8080' });
      const warning = context.logs.listServer({ source: 'config' }, 50).items.find((entry) => /hmacKey/.test(entry.message));
      assert.equal(warning?.level, 'warn');
      assert.match(warning!.message, /deprecated and ignored.*Remove it/);
      assert.equal(JSON.stringify(context.logs.listServer({}, 50).items).includes(configured), false);
      context.db.close();
      context.logs.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
