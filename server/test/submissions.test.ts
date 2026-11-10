import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { createChallenge, solveChallenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/sha';
import { after, describe, it } from 'node:test';
import { parseConfigText } from '../config';
import { detectImageType, validateImage } from '../images';
import { getSecret } from '../repository';
import { CSRF, JPEG, PNG, createTestServer, multipart, setupAdmin, solveAltcha, validEvent } from './helpers';
import type { MultipartFile, TestServer } from './helpers';

const servers: TestServer[] = [];
after(async () => { for (const server of servers) await server.close(); });
async function server(config?: string) {
  const created = await createTestServer({ config });
  servers.push(created);
  return created;
}

async function submit(test: TestServer, options: { altcha?: string | null; cover?: MultipartFile; event?: object; username?: string } = {}) {
  const altcha = options.altcha === undefined ? await solveAltcha(test) : options.altcha;
  const fields: Record<string, string> = {
    event: JSON.stringify(options.event ?? { ...validEvent, description: '<script>alert(1)</script> **bold**' }),
    agtUsername: options.username ?? 'Traveller42',
  };
  if (altcha !== null) fields.altcha = altcha;
  const body = multipart(fields, options.cover ? [options.cover] : []);
  return test.app.inject({ method: 'POST', url: '/api/submissions', payload: body.payload, headers: body.headers });
}

const cover = (data: Buffer, fileName = 'cover.jpg', contentType = 'image/jpeg'): MultipartFile =>
  ({ name: 'cover', fileName, contentType, data });

describe('public submissions', () => {
  it('accepts an anonymous submission with an AGT username into the moderation queue', async () => {
    const test = await server();
    const response = await submit(test, { cover: cover(JPEG) });
    assert.equal(response.statusCode, 201, response.body);
    const { id, status } = response.json();
    assert.equal(status, 'pending');

    assert.deepEqual((await test.app.inject({ method: 'GET', url: '/api/events' })).json(), []);
    assert.equal((await test.app.inject({ method: 'GET', url: `/api/events/${id}` })).statusCode, 404);

    const cookie = await setupAdmin(test);
    const queue = (await test.app.inject({ method: 'GET', url: '/api/admin/events?status=pending', headers: { cookie } })).json();
    assert.equal(queue.length, 1);
    assert.equal(queue[0].submitterAgtUsername, 'Traveller42');
    assert.equal(queue[0].description, '<script>alert(1)</script> **bold**', 'Markdown is stored as written');
    const imageId = queue[0].coverImageId;
    assert.ok(imageId);

    assert.equal((await test.app.inject({ method: 'GET', url: `/api/images/${imageId}` })).statusCode, 404, 'pending covers are private');
    const adminImage = await test.app.inject({ method: 'GET', url: `/api/images/${imageId}`, headers: { cookie } });
    assert.equal(adminImage.statusCode, 200);

    await test.app.inject({ method: 'POST', url: `/api/admin/events/${id}/status`, headers: { cookie, ...CSRF }, payload: { status: 'published' } });
    const publicEvent = (await test.app.inject({ method: 'GET', url: `/api/events/${id}` })).json();
    assert.equal('submitterAgtUsername' in publicEvent, false);
    const image = await test.app.inject({ method: 'GET', url: `/api/images/${imageId}` });
    assert.equal(image.statusCode, 200);
    assert.equal(image.headers['content-type'], 'image/jpeg');
    assert.equal(image.headers['x-content-type-options'], 'nosniff');
    assert.equal(image.rawPayload.length, JPEG.length);
    const files = readdirSync(test.context.config.uploadsDir);
    assert.equal(files.length, 1);
    assert.match(files[0], /^[0-9a-f-]{36}\.jpg$/, 'stored under a random server-generated name');
  });

  it('requires the AGT username and has no email field', async () => {
    const test = await server();
    const response = await submit(test, { username: '', event: { ...validEvent, email: 'a@example.com' } });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json().fields.map((field: { field: string }) => field.field), ['agtUsername']);
    const ok = await submit(test, { event: { ...validEvent, email: 'a@example.com' } });
    assert.equal(ok.statusCode, 201);
    const columns = (test.context.db.prepare('PRAGMA table_info(events)').all() as { name: string }[]).map((column) => column.name);
    assert.equal(columns.some((name) => /mail/i.test(name)), false);
  });

  it('requires a valid, unused ALTCHA solution', async () => {
    const test = await server();
    assert.equal((await submit(test, { altcha: null })).statusCode, 400);
    assert.equal((await submit(test, { altcha: Buffer.from('{"bad":true}').toString('base64') })).statusCode, 400);
    const payload = await solveAltcha(test);
    assert.equal((await submit(test, { altcha: payload })).statusCode, 201);
    const replay = await submit(test, { altcha: payload });
    assert.equal(replay.statusCode, 400);
    assert.match(replay.json().message, /already used/);
  });

  it('rejects expired ALTCHA challenges', async () => {
    const test = await server();
    const hmacKey = getSecret(test.context.db, 'altcha_hmac_key')!;
    const challenge = await createChallenge({
      algorithm: 'SHA-256', cost: 1000, deriveKey, hmacSignatureSecret: hmacKey,
      expiresAt: Math.floor(Date.now() / 1000) - 60,
    });
    const solution = await solveChallenge({ challenge, deriveKey });
    const payload = Buffer.from(JSON.stringify({ challenge, solution })).toString('base64');
    const response = await submit(test, { altcha: payload });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, 'captcha_failed');
    assert.match(response.json().message, /expired/);
  });

  it('rejects submissions on the server when they are turned off in the dashboard', async () => {
    const test = await server();
    const altcha = await solveAltcha(test);
    const cookie = await setupAdmin(test);
    await test.app.inject({
      method: 'PUT', url: '/api/admin/settings', headers: { cookie, ...CSRF }, payload: { values: { 'submissions.enabled': false } },
    });
    const response = await submit(test, { altcha });
    assert.equal(response.statusCode, 403);
    assert.match(response.json().message, /closed/);
    assert.equal((await test.app.inject({ method: 'GET', url: '/api/altcha/challenge' })).statusCode, 403);
  });

  it('rejects submissions when turned off in config.yaml', async () => {
    const test = await server('submissions:\n  enabled: false\n');
    const response = await submit(test, { altcha: 'x', cover: cover(JPEG) });
    assert.equal(response.statusCode, 403);
    assert.equal(readdirSync(test.context.config.dataDir).includes('uploads'), false);
  });

  it('rate limits submissions with the configured thresholds', async () => {
    const test = await server('submissions:\n  rateLimit:\n    max: 1\n    windowMinutes: 5\n');
    assert.equal((await submit(test)).statusCode, 201);
    assert.equal((await submit(test)).statusCode, 429);
  });
});

describe('uploaded image checks', () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const html = Buffer.from('<!doctype html><script>alert(1)</script>');

  it('detects types from contents', () => {
    assert.equal(detectImageType(JPEG), 'image/jpeg');
    assert.equal(detectImageType(PNG), 'image/png');
    assert.equal(detectImageType(Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00', 'latin1')), 'image/gif');
    assert.equal(detectImageType(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 \x00\x00', 'latin1')), 'image/webp');
    assert.equal(detectImageType(svg), null);
    assert.equal(detectImageType(Buffer.from([0xff])), null);
  });

  it('rejects SVG, disguised HTML, mismatched declarations and oversized files', async () => {
    const test = await server();
    for (const file of [
      cover(svg, 'cover.svg', 'image/svg+xml'),
      cover(html, 'cover.png', 'image/png'),
      cover(PNG, 'cover.jpg', 'image/jpeg'),
      cover(PNG, 'cover.png', 'image/jpeg'),
      cover(JPEG, 'cover.html', 'image/jpeg'),
    ]) {
      const response = await submit(test, { cover: file });
      assert.equal(response.statusCode, 415, `${file.fileName}: ${response.body}`);
    }
    assert.throws(() => validateImage(Buffer.alloc(11 * 1024 * 1024, 0xff), { maxBytes: 50 * 1024 * 1024 }), /10 MB/);
    assert.equal((test.context.db.prepare('SELECT count(*) AS n FROM events').get() as { n: number }).n, 0);
  });

  it('enforces the size limit while streaming the upload', async () => {
    const test = await server('uploads:\n  maxImageBytes: 2048\n');
    const response = await submit(test, { cover: cover(JPEG) });
    assert.equal(response.statusCode, 413);
    assert.throws(() => parseConfigText('uploads:\n  maxImageBytes: 20000000\n'), /uploads\.maxImageBytes/);
  });

  it('lets the admin upload, replace, delete and clean up images', async () => {
    const test = await server();
    const headers = { cookie: await setupAdmin(test), ...CSRF };
    const upload = (file: MultipartFile, method = 'POST', url = '/api/admin/images') => {
      const body = multipart({}, [file]);
      return test.app.inject({ method: method as 'POST', url, payload: body.payload, headers: { ...headers, ...body.headers } });
    };
    const first = await upload({ name: 'file', fileName: 'a.png', contentType: 'image/png', data: PNG });
    assert.equal(first.statusCode, 201, first.body);
    const id = first.json().image.id;
    const replaced = await upload({ name: 'file', fileName: 'b.jpg', contentType: 'image/jpeg', data: JPEG }, 'PUT', `/api/admin/images/${id}`);
    assert.equal(replaced.json().image.mimeType, 'image/jpeg');
    assert.equal(readdirSync(test.context.config.uploadsDir).length, 1);
    const svgUpload = await upload({ name: 'file', fileName: 'x.svg', contentType: 'image/svg+xml', data: svg });
    assert.equal(svgUpload.statusCode, 415);

    await upload({ name: 'file', fileName: 'c.png', contentType: 'image/png', data: PNG });
    await test.app.inject({ method: 'POST', url: '/api/admin/events', headers, payload: { ...validEvent, coverImageId: id } });
    const cleanup = await test.app.inject({ method: 'POST', url: '/api/admin/images/cleanup', headers });
    assert.equal(cleanup.json().removed, 1);
    const images = (await test.app.inject({ method: 'GET', url: '/api/admin/images', headers })).json();
    assert.equal(images.length, 1);
    assert.equal(images[0].referencedBy.length, 1);
    assert.equal((await test.app.inject({ method: 'DELETE', url: `/api/admin/images/${id}`, headers })).statusCode, 204);
    assert.equal(readdirSync(test.context.config.uploadsDir).length, 0);
    const events = (await test.app.inject({ method: 'GET', url: '/api/admin/events', headers })).json();
    assert.equal(events[0].coverImageId, null);
  });
});
