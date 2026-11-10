import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { after, describe, it } from 'node:test';
import { ADMIN_ERROR_CODES, ERROR_CODES, FIELD_CODES } from '../../src/lib/errors';
import { ADMIN, CSRF, JPEG, PNG, SETUP_PASSWORD, createTestServer, multipart, setupAdmin, solveAltcha, validEvent } from './helpers';
import type { TestServer } from './helpers';

// Error codes, field codes and params (AGT web app spec API-6, I18N-6, TEST-4).

const servers: TestServer[] = [];
after(async () => { for (const server of servers) await server.close(); });
async function server(options?: Parameters<typeof createTestServer>[0]) {
  const created = await createTestServer(options);
  servers.push(created);
  return created;
}

const ALL_ERROR_CODES: readonly string[] = [...ERROR_CODES, ...ADMIN_ERROR_CODES];
const ALL_FIELD_CODES: readonly string[] = FIELD_CODES;

type Response = Awaited<ReturnType<TestServer['app']['inject']>>;

/** A `400 validation_failed` whose every field error has a known code and an English message. */
function assertValidationFailed(response: Response, expected: { field: string; code: string; params?: Record<string, unknown> }[]) {
  assert.equal(response.statusCode, 400, response.body);
  const body = response.json() as { error: string; message: string; fields: { field: string; code: string; message: string; params?: unknown }[] };
  assert.equal(body.error, 'validation_failed');
  assert.ok(body.fields.length > 0, 'has field errors');
  for (const field of body.fields) {
    assert.ok(ALL_FIELD_CODES.includes(field.code), `${field.field}: unknown field code ${field.code}`);
    assert.equal(typeof field.message, 'string');
    assert.ok(field.message.length > 0);
  }
  for (const want of expected) {
    const found = body.fields.find((field) => field.field === want.field && field.code === want.code);
    assert.ok(found, `expected ${want.field}: ${want.code} in ${JSON.stringify(body.fields)}`);
    if (want.params) assert.deepEqual(found.params, want.params);
  }
}

describe('error codes (API-6)', () => {
  it('every 400 validation_failed has a code on each field', async () => {
    const test = await server();
    const setup = (payload: Record<string, unknown>) =>
      test.app.inject({ method: 'POST', url: '/api/setup', headers: CSRF, payload: { setupPassword: SETUP_PASSWORD, ...ADMIN, ...payload } });
    assertValidationFailed(await setup({ username: '  ' }), [{ field: 'username', code: 'required' }]);
    assertValidationFailed(await setup({ password: 'short' }), [{ field: 'password', code: 'too_short', params: { min: 12 } }]);
    assertValidationFailed(await setup({ password: SETUP_PASSWORD }), [{ field: 'password', code: 'same_as_setup_password' }]);
    // Request schemas give field codes too (AUTH-3: a 65-character username).
    assertValidationFailed(await setup({ username: 'a'.repeat(65) }), [{ field: 'username', code: 'too_long', params: { max: 64 } }]);

    const cookie = await setupAdmin(test);
    const headers = { cookie, ...CSRF };
    const post = (url: string, payload: unknown) => test.app.inject({ method: 'POST', url, headers, payload: payload as never });
    assertValidationFailed(await post('/api/admin/events', { ...validEvent, name: '', portalCode: 'XYZ', end: '2020-01-01T00:00:00Z' }), [
      { field: 'name', code: 'required' },
      { field: 'portalCode', code: 'invalid_format' },
      { field: 'end', code: 'end_before_start' },
    ]);
    assertValidationFailed(await post('/api/admin/events', { ...validEvent, links: Array.from({ length: 21 }, (_, index) => `https://example.com/${index}`) }), [
      { field: 'links', code: 'too_many', params: { max: 20 } },
    ]);
    assertValidationFailed(await post('/api/admin/events', { ...validEvent, coverImageId: '3f2b8c1e-9d4a-4f6b-8a2c-1e5d7f9b0a3c' }), [
      { field: 'coverImageId', code: 'image_not_found' },
    ]);
    assertValidationFailed(await post('/api/admin/holidays', { name: 'x', civilization: 'y', date: '2020-13-45', type: 'z' }), [
      { field: 'date', code: 'invalid_format' },
    ]);
    assertValidationFailed(await post('/api/admin/changelog', { date: '2020-01-01', changes: 'x'.repeat(10_001) }), [
      { field: 'changes', code: 'too_long' },
    ]);
    assertValidationFailed(await post('/api/admin/password', { currentPassword: ADMIN.password, newPassword: 'short' }), [
      { field: 'newPassword', code: 'too_short', params: { min: 12 } },
    ]);

    const altcha = await solveAltcha(test);
    const form = multipart({ event: JSON.stringify({ ...validEvent, galaxy: '' }), agtUsername: '', altcha });
    assertValidationFailed(await test.app.inject({ method: 'POST', url: '/api/submissions', headers: form.headers, payload: form.payload }), [
      { field: 'galaxy', code: 'required' },
      { field: 'agtUsername', code: 'required' },
    ]);
  });

  it('notices carry field codes too', async () => {
    const test = await server();
    const headers = { cookie: await setupAdmin(test), ...CSRF };
    const response = await test.app.inject({
      method: 'POST', url: '/api/admin/events', headers, payload: { ...validEvent, links: ['javascript:alert(1)', 'https://example.com/'] },
    });
    assert.equal(response.statusCode, 201, response.body);
    assert.deepEqual(response.json().notices.map((notice: { field: string; code: string; params: unknown }) => [notice.field, notice.code, notice.params]), [
      ['links', 'link_ignored', { value: 'javascript:alert(1)' }],
    ]);
  });

  it('sends params for rate_limited, file_too_large, field_too_large and defined_in_config', async () => {
    const limited = await server({ config: 'rateLimits:\n  setup:\n    max: 1\nsite:\n  title: Configured\n' });
    const attempt = () => limited.app.inject({ method: 'POST', url: '/api/setup', headers: CSRF, payload: { setupPassword: 'x', ...ADMIN } });
    await attempt();
    const rate = await attempt();
    assert.equal(rate.statusCode, 429);
    assert.equal(rate.json().error, 'rate_limited');
    assert.equal(typeof rate.json().params.retryAfterSeconds, 'number');
    assert.ok(rate.json().params.retryAfterSeconds > 0);
    assert.equal(rate.headers['retry-after'], String(rate.json().params.retryAfterSeconds));

    const test = await server({ config: 'site:\n  title: Configured\n' });
    const headers = { cookie: await setupAdmin(test), ...CSRF };
    const locked = await test.app.inject({ method: 'PUT', url: '/api/admin/settings', headers, payload: { values: { 'site.title': 'Other' } } });
    assert.equal(locked.statusCode, 409);
    assert.deepEqual([locked.json().error, locked.json().params], ['defined_in_config', { key: 'site.title' }]);

    await test.app.inject({ method: 'PUT', url: '/api/admin/settings', headers, payload: { values: { 'uploads.maxImageBytes': 1024 } } });
    const upload = (data: Buffer, fileName: string, contentType: string) => {
      const body = multipart({}, [{ name: 'file', fileName, contentType, data }]);
      return test.app.inject({ method: 'POST', url: '/api/admin/images', payload: body.payload, headers: { ...headers, ...body.headers } });
    };
    const big = await upload(JPEG, 'big.jpg', 'image/jpeg');
    assert.equal(big.statusCode, 413);
    assert.deepEqual([big.json().error, big.json().params], ['file_too_large', { maxBytes: 1024 }]);
    assert.equal((await upload(PNG, 'small.png', 'image/png')).statusCode, 201, 'a small image still uploads');

    const field = multipart({ event: 'x'.repeat(1024 * 1024 + 10), agtUsername: 'someone', altcha: 'x' });
    const tooLong = await test.app.inject({ method: 'POST', url: '/api/submissions', headers: field.headers, payload: field.payload });
    assert.equal(tooLong.statusCode, 413);
    assert.deepEqual([tooLong.json().error, tooLong.json().params], ['field_too_large', { maxBytes: 1024 * 1024 }]);
  });

  it('every error code the server sends is a documented code', () => {
    const sent = new Set<string>();
    for (const file of readdirSync('server').filter((name) => name.endsWith('.ts'))) {
      const source = readFileSync(`server/${file}`, 'utf8');
      for (const match of source.matchAll(/HttpError\(\d{3}, '([a-z_]+)'/g)) sent.add(match[1]);
      for (const match of source.matchAll(/error: '([a-z_]+)'/g)) sent.add(match[1]);
    }
    assert.ok(sent.size > 15);
    for (const code of sent) assert.ok(ALL_ERROR_CODES.includes(code), `${code} is not in ERROR_CODES or ADMIN_ERROR_CODES`);
  });

  it('lists every error and field code in the OpenAPI schema descriptions', async () => {
    const test = await server();
    const document = (await test.app.inject({ method: 'GET', url: '/api/openapi.json' })).json();
    const schemas = JSON.stringify(document);
    for (const code of [...ALL_ERROR_CODES, ...ALL_FIELD_CODES]) assert.ok(schemas.includes(`\`${code}\``), code);
  });
});
