/**
 * OpenAPI 3.1 document generated from the route schemas (AGT web app spec
 * API-10..13). Registered before any route so @fastify/swagger sees them all.
 * The document is served at GET /api/openapi.json.
 */
import fastifySwagger from '@fastify/swagger';
import type { FastifyInstance, FastifySchema } from 'fastify';
import { CSRF_HEADER, SESSION_COOKIE } from './session';
import { ErrorBodySchema } from './schemas';

declare module 'fastify' {
  interface FastifyInstance {
    /** Every /api/ route registered on the app (HEAD excluded); used by the OpenAPI completeness test. */
    apiRoutes: { method: string; url: string; hidden: boolean; audit: boolean }[];
  }
  interface FastifyContextConfig {
    /**
     * Documentation-only schema of a multipart/form-data body. Fastify cannot
     * validate multipart bodies with a schema (the handler reads the parts),
     * so it is added to the OpenAPI document only.
     */
    multipartBody?: { readonly [key: string]: unknown };
  }
}

/** Security requirements, as used in route schemas. */
export const SECURITY = {
  /** Anonymous; no cookie or header needed. */
  public: [],
  /** Anonymous, but the CSRF header is required (setup, login, logout). */
  csrf: [{ csrfHeader: [] }],
  /** Admin reads: a valid session cookie. */
  adminRead: [{ sessionCookie: [] }],
  /** Admin writes: a valid session cookie and the CSRF header. */
  adminWrite: [{ sessionCookie: [], csrfHeader: [] }],
} as const;

/** The `default` response every operation declares: the shared error body. */
export const errorResponses = { default: ErrorBodySchema };

export async function registerOpenApi(app: FastifyInstance, version: string): Promise<void> {
  const apiRoutes: FastifyInstance['apiRoutes'] = [];
  app.decorate('apiRoutes', apiRoutes);
  app.addHook('onRoute', (route) => {
    if (!route.url.startsWith('/api/')) return;
    for (const method of ([] as string[]).concat(route.method)) {
      if (method !== 'HEAD') {
        apiRoutes.push({ method, url: route.url, hidden: route.schema?.hide === true, audit: route.config?.audit === true });
      }
    }
  });

  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'AGT Event Calendar API',
        version,
        description:
          'REST API of the self-hosted AGT Event Calendar. Admin routes need the session cookie set by '
          + `/api/admin/login; state-changing admin, setup and login requests also need the \`${CSRF_HEADER}: 1\` header. `
          + 'Errors use the ErrorBody shape. Server messages are English.',
      },
      tags: [
        { name: 'public', description: 'Anonymous calendar data.' },
        { name: 'submissions', description: 'Anonymous event submissions, protected by ALTCHA and rate limits.' },
        { name: 'auth', description: 'First-run setup and admin sign-in.' },
        { name: 'admin', description: 'Admin account and dashboard settings.' },
        { name: 'events', description: 'Admin event management and moderation.' },
        { name: 'holidays', description: 'Admin national holiday management.' },
        { name: 'changelog', description: 'Admin change-log management.' },
        { name: 'images', description: 'Uploaded images.' },
        { name: 'backup', description: 'Backup, restore and Migrate from Amplify.' },
        { name: 'logs', description: 'Server log and audit log. Audit entries can be read and exported, never changed.' },
      ],
      components: {
        securitySchemes: {
          sessionCookie: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE },
          csrfHeader: { type: 'apiKey', in: 'header', name: CSRF_HEADER, description: 'Must be "1".' },
        },
      },
    },
    transform: ({ schema, url, route }) => {
      const multipartBody = route.config?.multipartBody;
      if (!multipartBody) return { schema, url };
      const documented: FastifySchema = { ...schema, body: multipartBody, consumes: ['multipart/form-data'] };
      return { schema: documented, url };
    },
  });

  app.get('/api/openapi.json', { config: { writesData: false }, schema: { hide: true } }, async () => app.swagger());
}
