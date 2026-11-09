import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { CSRF, createTestServer, setupAdmin } from './helpers';
import type { TestServer } from './helpers';

const servers: TestServer[] = [];
after(async () => { for (const server of servers) await server.close(); });
async function server() {
  const created = await createTestServer();
  servers.push(created);
  return created;
}

interface Operation {
  operationId?: string;
  tags?: string[];
  summary?: string;
  security?: Record<string, string[]>[];
  requestBody?: { content: Record<string, unknown> };
  responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
}
type OpenApiDocument = {
  openapi: string;
  info: { version: string };
  paths: Record<string, Record<string, Operation>>;
  components: { securitySchemes: Record<string, unknown> };
};

/** Fastify `/api/events/:id` → OpenAPI `/api/events/{id}`. */
const openApiPath = (url: string) => url.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
/** Fills path parameters with a syntactically valid UUID. */
const concrete = (url: string) => url.replace(/:[A-Za-z0-9_]+/g, '00000000-0000-4000-8000-000000000000');

describe('OpenAPI document', () => {
  it('is served at /api/openapi.json as OpenAPI 3.1 with the app version', async () => {
    const { app, context } = await server();
    const response = await app.inject({ method: 'GET', url: '/api/openapi.json' });
    assert.equal(response.statusCode, 200);
    const doc = response.json() as OpenApiDocument;
    assert.equal(doc.openapi, '3.1.0');
    assert.equal(doc.info.version, context.version);
    assert.deepEqual(Object.keys(doc.components.securitySchemes).sort(), ['csrfHeader', 'sessionCookie']);
    assert.equal(doc.paths['/api/openapi.json'], undefined, 'the document does not describe itself');
  });

  it('describes every API route completely', async () => {
    const { app } = await server();
    const doc = (await app.inject({ method: 'GET', url: '/api/openapi.json' })).json() as OpenApiDocument;
    const routes = app.apiRoutes.filter((route) => !route.hidden);
    assert.ok(routes.length >= 35, `expected all API routes to be collected, got ${routes.length}`);

    const operationIds = new Set<string>();
    for (const route of routes) {
      const label = `${route.method} ${route.url}`;
      const operation = doc.paths[openApiPath(route.url)]?.[route.method.toLowerCase()];
      assert.ok(operation, `${label} is in the OpenAPI document`);
      assert.ok(operation.operationId, `${label} has an operationId`);
      assert.ok(!operationIds.has(operation.operationId), `${label} has a unique operationId`);
      operationIds.add(operation.operationId);
      assert.ok(operation.tags && operation.tags.length > 0, `${label} has tags`);
      assert.ok(operation.summary, `${label} has a summary`);
      assert.ok(Array.isArray(operation.security), `${label} declares its security requirements`);

      const responses = operation.responses ?? {};
      const success = Object.keys(responses).filter((status) => /^2\d\d$/.test(status));
      assert.ok(success.length > 0, `${label} documents a 2xx response`);
      for (const status of success) {
        if (status === '204') continue;
        const content = responses[status].content ?? {};
        assert.ok(Object.values(content).some((media) => media.schema), `${label} ${status} has a response schema`);
      }
      assert.ok(responses.default?.content?.['application/json']?.schema, `${label} documents the error body as default`);

      if (route.url.startsWith('/api/admin/') && route.url !== '/api/admin/login' && route.url !== '/api/admin/logout') {
        const schemes = (operation.security ?? []).flatMap((requirement) => Object.keys(requirement));
        assert.ok(schemes.includes('sessionCookie'), `${label} requires the session cookie`);
        if (route.method !== 'GET') assert.ok(schemes.includes('csrfHeader'), `${label} requires the CSRF header`);
      }
    }
  });

  it('documents multipart uploads with their form fields', async () => {
    const { app } = await server();
    const doc = (await app.inject({ method: 'GET', url: '/api/openapi.json' })).json() as OpenApiDocument;
    for (const [path, method] of [
      ['/api/submissions', 'post'], ['/api/admin/images', 'post'], ['/api/admin/images/{id}', 'put'],
      ['/api/admin/migrate', 'post'], ['/api/admin/restore', 'post'],
    ] as const) {
      const content = doc.paths[path][method].requestBody?.content ?? {};
      assert.ok(content['multipart/form-data'], `${method.toUpperCase()} ${path} documents a multipart body`);
    }
  });
});

describe('admin route protection', () => {
  it('rejects every admin route without a session, and every admin mutation without the CSRF header', async () => {
    const test = await server();
    const adminRoutes = test.app.apiRoutes.filter((route) =>
      route.url.startsWith('/api/admin/') && route.url !== '/api/admin/login' && route.url !== '/api/admin/logout');
    assert.ok(adminRoutes.length >= 25);
    for (const route of adminRoutes) {
      const method = route.method as 'GET' | 'POST' | 'PUT' | 'DELETE';
      const anonymous = await test.app.inject({ method, url: concrete(route.url), headers: CSRF });
      assert.equal(anonymous.statusCode, 401, `${route.method} ${route.url} without a session`);
      assert.equal(anonymous.json().error, 'unauthorized');
    }

    const cookie = await setupAdmin(test);
    for (const route of adminRoutes.filter((candidate) => candidate.method !== 'GET')) {
      const method = route.method as 'POST' | 'PUT' | 'DELETE';
      const noCsrf = await test.app.inject({ method, url: concrete(route.url), headers: { cookie } });
      assert.equal(noCsrf.statusCode, 403, `${route.method} ${route.url} without the CSRF header`);
      assert.equal(noCsrf.json().error, 'csrf');
    }
  });

  it('returns the error body for schema violations', async () => {
    const test = await server();
    const cookie = await setupAdmin(test);
    const response = await test.app.inject({
      method: 'POST', url: '/api/admin/holidays', headers: { cookie, ...CSRF }, payload: { name: 'x', unexpected: true },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, 'invalid_request');
    assert.equal(typeof response.json().message, 'string');
  });
});
