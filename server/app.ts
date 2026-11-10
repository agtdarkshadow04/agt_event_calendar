import { randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import Fastify, { LogController } from 'fastify';
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from 'fastify';
import { fieldError } from '../src/lib/errors';
import type { FieldError } from '../src/lib/errors';
import type { ApiEvent, PublicSettings } from '../src/lib/api';
import { isLegacyEventId, isUuidV4, validateAgtUsername, validateEventInput } from '../src/lib/validation';
import { registerAdminRoutes } from './adminRoutes';
import { auditFailure, registerAudit, setAudit } from './audit';
import { createAltchaChallenge, ensureAltchaKey, verifyAltchaPayload } from './altcha';
import type { AppContext } from './context';
import { setting } from './context';
import { asOperationOwner, registerOperationLock } from './dataWrite';
import { HttpError, isLoopbackAddress, readMultipart } from './http';
import { createLogger, scheduleRetention } from './logs';
import { SECURITY, errorResponses, registerOpenApi } from './openapi';
import {
  AltchaChallengeSchema, ApiChangeLogEntrySchema, ApiEventSchema, ApiHolidaySchema,
  PublicSettingsSchema, SetupStatusSchema, SubmissionFormSchema, SubmissionResultSchema, UsernameSchema, binaryResponse,
} from './schemas';
import { hasValidSession, isRecoveryRequest, requireCsrfHeader, startSession } from './session';
import { ImageRejectedError, removeImageFile, validateImage, writeImageFile } from './images';
import { MAX_PASSWORD_LENGTH, MAX_USERNAME_LENGTH, MIN_PASSWORD_LENGTH, checkAdminPassword, hashPassword, secretsEqual } from './passwords';
import {
  createAdmin, getAdmin, getEvent, getEventByLegacyId, getImage, insertEvent,
  insertImage, listChangeLog, listEvents, listHolidays,
} from './repository';
import { ZipRejectedError } from './zip';

/**
 * The Content-Security-Policy sent with every response. Scripts may only come
 * from the app itself; images may come from anywhere (authors can reference
 * external images in Markdown). ALTCHA's proof-of-work runs in a bundled,
 * same-origin worker, so `worker-src 'self'` is enough.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  // blob: lets the submission form preview the selected cover before upload.
  "img-src 'self' https: http: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const NO_STORE = 'no-store, no-cache, must-revalidate, max-age=0';

export interface BuildOptions {
  /**
   * The pino logger from `createLogger()` (stdout + server log). Without one,
   * entries still go to the server log but not to stdout.
   */
  logger?: FastifyBaseLogger;
  /** Directory with the built SPA (`dist/`). Skipped when it does not exist. */
  staticDir?: string;
}

/** Public event shape; the response schema also strips status and submitter fields. */
function toPublicEvent(event: ApiEvent): ApiEvent {
  return {
    id: event.id, legacyId: event.legacyId, name: event.name, start: event.start, end: event.end,
    civilization: event.civilization, type: event.type, description: event.description, coverImageId: event.coverImageId,
    links: event.links, galaxy: event.galaxy, region: event.region, system: event.system, planet: event.planet,
    portalCode: event.portalCode,
  };
}

export function publicSettings(context: AppContext): PublicSettings {
  return {
    siteTitle: setting(context, 'site.title'),
    supportUrl: setting(context, 'site.supportUrl'),
    glyphToolUrl: setting(context, 'site.glyphToolUrl'),
    submissionsEnabled: setting(context, 'submissions.enabled'),
    maxImageBytes: setting(context, 'uploads.maxImageBytes'),
  };
}

/** JSON request bodies are limited to 2 MiB (AUTH-5); multipart uploads have their own limits. */
const BODY_LIMIT_BYTES = 2 * 1024 * 1024;

interface SchemaIssue {
  keyword?: string;
  instancePath?: string;
  params?: { missingProperty?: string; additionalProperty?: string; limit?: number };
}

/**
 * Field errors with standard codes (API-6) from a request body's schema validation. Field names and limits only,
 * never the submitted values.
 */
function schemaErrorFields(validation: unknown): FieldError[] {
  if (!Array.isArray(validation)) return [];
  return validation.map((issue: SchemaIssue) => {
    const pathField = (issue.instancePath ?? '').replace(/^\//, '').replaceAll('/', '.');
    const field = [pathField, issue.params?.missingProperty ?? issue.params?.additionalProperty].filter(Boolean).join('.') || '(body)';
    const limit = issue.params?.limit;
    switch (issue.keyword) {
      case 'required': return fieldError(field, 'required', field);
      case 'maxLength': return fieldError(field, 'too_long', field, { max: limit ?? 0 });
      case 'minLength': return limit === 1 ? fieldError(field, 'required', field) : fieldError(field, 'too_short', field, { min: limit ?? 0 });
      case 'maxItems': return fieldError(field, 'too_many', field, { max: limit ?? 0 });
      case 'maximum': return fieldError(field, 'out_of_range', field, { max: limit ?? 0 });
      case 'minimum': return fieldError(field, 'out_of_range', field, { min: limit ?? 0 });
      case 'additionalProperties': case 'enum': case 'const': return fieldError(field, 'not_allowed', field);
      default: return fieldError(field, 'invalid_format', field);
    }
  });
}

const rateLimit = (max: number | ((request: FastifyRequest) => number), windowMinutes: number | ((request: FastifyRequest) => number)) => ({
  rateLimit: {
    max,
    timeWindow: typeof windowMinutes === 'number'
      ? windowMinutes * 60_000
      : (request: FastifyRequest) => windowMinutes(request) * 60_000,
  },
});

export async function buildApp(context: AppContext, options: BuildOptions = {}): Promise<FastifyInstance> {
  // Generated secrets are created at startup, never by a request (ALT-2, SEC-8).
  asOperationOwner(() => ensureAltchaKey(context.db));
  const app = Fastify({
    loggerInstance: options.logger ?? createLogger(context.logs, 'silent', null),
    // Access logs describe user activity, which the audit log covers (LOG-6).
    logController: new LogController({ disableRequestLogging: true }),
    // Request IDs link an audit entry to the server log entry of the same request.
    genReqId: () => randomUUID(),
    trustProxy: context.config.trustProxy,
    bodyLimit: BODY_LIMIT_BYTES,
  }).withTypeProvider<TypeBoxTypeProvider>();

  // Cookies first: the lock's onRequest hook reads the session cookie of a failed restore's recovery session.
  await app.register(fastifyCookie);
  registerOperationLock(app, context.operation, (request) => isRecoveryRequest(context, request));
  await registerOpenApi(app, context.version);
  registerAudit(app, context);
  scheduleRetention(app, context);
  await app.register(fastifyMultipart, { throwFileSizeLimit: true });
  await app.register(fastifyRateLimit, {
    global: false,
    // Thrown by the plugin, so the error handler answers it like every other error, with params (API-6).
    errorResponseBuilder: (_request, rate) => {
      const retryAfterSeconds = Math.max(1, Math.ceil(rate.ttl / 1000));
      return new HttpError(429, 'rate_limited', `Too many requests. Try again in ${retryAfterSeconds} seconds.`, undefined, { retryAfterSeconds });
    },
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    const url = request.url;
    if (!url.startsWith('/assets/') && !reply.hasHeader('Cache-Control')) {
      reply.header('Cache-Control', NO_STORE);
      reply.header('Pragma', 'no-cache');
      reply.header('Expires', '0');
    }
    return payload;
  });

  app.setErrorHandler((error: Error & { statusCode?: number; code?: string; validation?: unknown; validationContext?: string }, request, reply) => {
    if (error instanceof HttpError) {
      auditFailure(request, error.code, error.fields);
      const retryAfter = error.params?.retryAfterSeconds;
      if (typeof retryAfter === 'number') reply.header('Retry-After', String(retryAfter));
      return reply.status(error.statusCode).send({ error: error.code, message: error.message, fields: error.fields, params: error.params });
    }
    if (error instanceof ImageRejectedError) {
      if (error.maxBytes !== undefined) {
        auditFailure(request, 'file_too_large');
        return reply.status(413).send({ error: 'file_too_large', message: error.message, params: { maxBytes: error.maxBytes } });
      }
      auditFailure(request, 'image_rejected');
      return reply.status(error.statusCode).send({ error: 'image_rejected', message: error.message });
    }
    if (error instanceof ZipRejectedError) {
      auditFailure(request, 'archive_rejected');
      return reply.status(422).send({ error: 'archive_rejected', message: error.message });
    }
    if (error.validation) {
      // A body that fails its schema is a validation error with field codes (API-6, AUTH-3); bad paths and
      // query strings are malformed requests.
      if (error.validationContext === 'body') {
        const fields = schemaErrorFields(error.validation);
        auditFailure(request, 'validation_failed', fields);
        return reply.status(400).send({ error: 'validation_failed', message: fields[0]?.message ?? error.message, fields });
      }
      auditFailure(request, 'invalid_request');
      return reply.status(400).send({ error: 'invalid_request', message: error.message });
    }
    if (error.code === 'FST_REQ_FILE_TOO_LARGE' || error.statusCode === 413) {
      auditFailure(request, 'file_too_large');
      return reply.status(413).send({ error: 'file_too_large', message: 'The upload is too large.', params: { maxBytes: BODY_LIMIT_BYTES } });
    }
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      // Fastify's own client errors (malformed JSON, unsupported media type, …) get a standard code.
      const code = error.statusCode === 415 ? 'multipart_required' : 'invalid_request';
      auditFailure(request, code);
      return reply.status(error.statusCode).send({ error: code, message: error.message });
    }
    auditFailure(request, 'internal');
    // Only the error's name, message and stack, and the route: never headers or the body (LOG-9).
    request.log.error({
      source: 'http',
      err: { name: error.name, message: error.message, stack: error.stack },
      method: request.method,
      route: request.routeOptions.url ?? null,
    }, `Unexpected error: ${error.message}`);
    return reply.status(500).send({ error: 'internal', message: 'An unexpected server error occurred.' });
  });

  // ------------------------------------------------------------- public API

  app.get('/api/health', {
    config: { writesData: false },
    schema: {
      operationId: 'getHealth', tags: ['public'], summary: 'Checks that the server and database respond.',
      security: SECURITY.public,
      response: {
        200: Type.Object({
          status: Type.Union([Type.Literal('ok'), Type.Literal('maintenance')], {
            description: '`maintenance` while a restore runs (SRV-11); the database is not queried then.',
          }),
        }),
        ...errorResponses,
      },
    },
  }, async () => {
    if (context.operation.maintenance) return { status: 'maintenance' as const };
    context.db.prepare('SELECT 1').get();
    return { status: 'ok' as const };
  });

  app.get('/api/settings/public', {
    config: { writesData: false },
    schema: {
      operationId: 'getPublicSettings', tags: ['public'], summary: 'Returns the settings the public calendar needs.',
      security: SECURITY.public,
      response: { 200: PublicSettingsSchema, ...errorResponses },
    },
  }, async () => publicSettings(context));

  app.get('/api/events', {
    config: { writesData: false },
    schema: {
      operationId: 'listEvents', tags: ['public'], summary: 'Lists published events.',
      security: SECURITY.public,
      response: { 200: Type.Array(ApiEventSchema), ...errorResponses },
    },
  }, async () =>
    listEvents(context.db, ['published']).map(toPublicEvent));

  app.get('/api/events/:id', {
    config: { writesData: false },
    schema: {
      operationId: 'getEvent', tags: ['public'],
      summary: 'Returns a published event by UUID or by its legacy 4-hex ID.',
      security: SECURITY.public,
      params: Type.Object({ id: Type.String({ maxLength: 64 }) }, { additionalProperties: false }),
      response: { 200: ApiEventSchema, ...errorResponses },
    },
  }, async (request) => {
    const { id } = request.params;
    const event = isUuidV4(id) ? getEvent(context.db, id) : isLegacyEventId(id) ? getEventByLegacyId(context.db, id) : null;
    if (!event || event.status !== 'published') throw new HttpError(404, 'not_found', 'Event not found.');
    return toPublicEvent(event);
  });

  app.get('/api/holidays', {
    config: { writesData: false },
    schema: {
      operationId: 'listHolidays', tags: ['public'], summary: 'Lists published national holidays.',
      security: SECURITY.public,
      response: { 200: Type.Array(ApiHolidaySchema), ...errorResponses },
    },
  }, async () =>
    listHolidays(context.db, true).map(({ published: _published, ...holiday }) => holiday));

  app.get('/api/changelog', {
    config: { writesData: false },
    schema: {
      operationId: 'listChangeLog', tags: ['public'], summary: 'Lists published change-log entries, newest first.',
      security: SECURITY.public,
      response: { 200: Type.Array(ApiChangeLogEntrySchema), ...errorResponses },
    },
  }, async () =>
    listChangeLog(context.db, true).map(({ published: _published, ...entry }) => entry));

  app.get('/api/images/:id', {
    config: { writesData: false },
    schema: {
      operationId: 'getImage', tags: ['images'],
      summary: 'Returns an uploaded image. Images of unpublished events are visible only to the admin.',
      security: SECURITY.public,
      params: Type.Object({ id: Type.String({ maxLength: 64 }) }, { additionalProperties: false }),
      response: {
        200: binaryResponse('The image file.', ['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
        ...errorResponses,
      },
    },
  }, async (request, reply) => {
    const image = isUuidV4(request.params.id) ? getImage(context.db, request.params.id) : null;
    const visible = image && (
      context.db.prepare("SELECT 1 FROM events WHERE cover_image_id = ? AND status = 'published'").get(image.id) !== undefined ||
      hasValidSession(context, request)
    );
    const filePath = image ? path.join(context.config.uploadsDir, image.fileName) : '';
    if (!image || !visible || !existsSync(filePath)) throw new HttpError(404, 'not_found', 'Image not found.');
    reply.header('Content-Type', image.mimeType);
    reply.header('Content-Length', image.sizeBytes);
    reply.header('Content-Disposition', 'inline');
    reply.header('Cache-Control', 'private, no-cache');
    // A stream is sent as is; the response schema only documents it.
    return reply.send(createReadStream(filePath) as unknown as string);
  });

  // ------------------------------------------------------------- submissions

  const submissionsEnabled = () => setting(context, 'submissions.enabled');
  const assertSubmissionsOpen = () => {
    if (!submissionsEnabled()) {
      throw new HttpError(403, 'submissions_closed', 'Event submissions are currently closed by the administrator.');
    }
  };

  app.get('/api/altcha/challenge', {
    config: { ...rateLimit(60, 1), writesData: false },
    schema: {
      operationId: 'getAltchaChallenge', tags: ['submissions'], summary: 'Issues an ALTCHA proof-of-work challenge.',
      security: SECURITY.public,
      response: { 200: AltchaChallengeSchema, ...errorResponses },
    },
  }, async () => {
    assertSubmissionsOpen();
    return createAltchaChallenge(context);
  });

  app.post('/api/submissions', {
    config: {
      writesData: true,
      ...rateLimit(
        () => setting(context, 'submissions.rateLimit.max'),
        () => setting(context, 'submissions.rateLimit.windowMinutes'),
      ),
      multipartBody: SubmissionFormSchema,
    },
    schema: {
      operationId: 'submitEvent', tags: ['submissions'],
      summary: 'Submits an event for moderation. Requires a solved ALTCHA challenge.',
      security: SECURITY.public,
      response: { 201: SubmissionResultSchema, ...errorResponses },
    },
  }, async (request, reply) => {
    assertSubmissionsOpen();
    const maxImageBytes = setting(context, 'uploads.maxImageBytes');
    const form = await readMultipart(request, { fileFields: ['cover'], maxFileBytes: maxImageBytes });
    const captchaError = await verifyAltchaPayload(context, form.fields.altcha);
    if (captchaError) throw new HttpError(400, 'captcha_failed', captchaError);

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(form.fields.event ?? '{}') as Record<string, unknown>;
    } catch {
      throw new HttpError(400, 'invalid_request', 'The event field must contain JSON.');
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new HttpError(400, 'invalid_request', 'The event field must contain a JSON object.');
    const username = validateAgtUsername(form.fields.agtUsername);
    // The AGT username is the identifier this feature already collects (LOG-10).
    if (username.ok) setAudit(request, { actor: username.value });
    const event = validateEventInput(raw);
    const errors = [...(username.ok ? [] : username.errors), ...(event.ok ? [] : event.errors)];
    if (!username.ok || !event.ok) throw new HttpError(400, 'validation_failed', 'The submission is invalid.', errors);

    const upload = form.files.get('cover');
    let coverImageId: string | null = null;
    if (upload?.data) {
      const mime = validateImage(upload.data, { maxBytes: maxImageBytes, declaredMime: upload.mimeType, fileName: upload.fileName });
      const image = writeImageFile(context.config.uploadsDir, upload.data, mime);
      try {
        context.db.transaction(() => {
          insertImage(context.db, image);
          coverImageId = image.id;
        })();
      } catch (error) {
        removeImageFile(context.config.uploadsDir, image.fileName);
        throw error;
      }
    }
    const id = insertEvent(context.db, event.value, {
      status: 'pending',
      coverImageId,
      submitterAgtUsername: username.value,
    });
    const coverImage = coverImageId ? getImage(context.db, coverImageId) : null;
    setAudit(request, {
      targetType: 'event',
      targetId: id,
      details: {
        name: event.value.name,
        cover: coverImage ? { sizeBytes: coverImage.sizeBytes, mimeType: coverImage.mimeType } : null,
      },
    });
    return reply.status(201).send({ id, status: 'pending' });
  });

  // ------------------------------------------------------------- first-run setup & auth

  // SEC-4: the app never encrypts, so warn once per process when credentials arrive over plain HTTP from another host.
  let plainHttpWarned = false;
  const warnPlainHttpCredentials = (request: FastifyRequest) => {
    if (plainHttpWarned || request.protocol !== 'http' || isLoopbackAddress(request.ip)) return;
    plainHttpWarned = true;
    app.log.warn({ source: 'security' },
      'Credentials were sent over plain HTTP from another host, unencrypted. Put a TLS-terminating reverse proxy in front of the app (README: TLS and reverse proxies).');
  };

  app.get('/api/setup/status', {
    config: { writesData: false },
    schema: {
      operationId: 'getSetupStatus', tags: ['auth'],
      summary: 'Tells whether the admin account exists and whether first-run setup is possible.',
      security: SECURITY.public,
      response: { 200: SetupStatusSchema, ...errorResponses },
    },
  }, async () => ({
    adminExists: getAdmin(context.db) !== null,
    setupPasswordConfigured: Boolean(context.setupPassword),
  }));

  app.post('/api/setup', {
    config: { ...rateLimit(context.config.rateLimits.setup.max, context.config.rateLimits.setup.windowMinutes), writesData: true },
    schema: {
      operationId: 'setupAdmin', tags: ['auth'],
      summary: 'First-run setup: creates the single admin account with the setup password from the environment.',
      security: SECURITY.csrf,
      response: { 201: UsernameSchema, ...errorResponses },
      body: Type.Object({
        setupPassword: Type.String({ maxLength: MAX_PASSWORD_LENGTH }),
        username: Type.String({ maxLength: MAX_USERNAME_LENGTH }),
        password: Type.String({ maxLength: MAX_PASSWORD_LENGTH }),
      }, { additionalProperties: false }),
    },
  }, async (request, reply) => {
    warnPlainHttpCredentials(request);
    requireCsrfHeader(request);
    if (getAdmin(context.db)) {
      throw new HttpError(410, 'setup_complete', 'The admin account already exists. First-run setup is disabled.');
    }
    if (!context.setupPassword) {
      throw new HttpError(503, 'setup_password_missing',
        'AGT_SETUP_PASSWORD is not set. Set it in .env and restart the container to create the admin account.');
    }
    if (!secretsEqual(request.body.setupPassword, context.setupPassword)) {
      throw new HttpError(401, 'invalid_setup_password', 'The setup password is incorrect.');
    }
    const username = request.body.username.trim();
    const { password } = request.body;
    const fields: FieldError[] = [];
    if (!username) fields.push(fieldError('username', 'required', 'The admin username'));
    if (password.length < MIN_PASSWORD_LENGTH) {
      fields.push(fieldError('password', 'too_short', 'The admin password', { min: MIN_PASSWORD_LENGTH }));
    }
    if (secretsEqual(password, context.setupPassword)) {
      fields.push(fieldError('password', 'same_as_setup_password', 'The admin password'));
    }
    if (fields.length > 0) throw new HttpError(400, 'validation_failed', fields[0].message, fields);
    if (!createAdmin(context.db, username, await hashPassword(password))) {
      throw new HttpError(410, 'setup_complete', 'The admin account already exists. First-run setup is disabled.');
    }
    // The audit entry records that setup happened. The server log gets only the
    // configuration reminder of AUTH-6, which is not tied to this request.
    setAudit(request, { actorType: 'admin', actor: username, targetType: 'admin' });
    app.log.warn({ source: 'config' }, 'The admin account now exists. Remove AGT_SETUP_PASSWORD from .env and restart.');
    startSession(context, request, reply);
    return reply.status(201).send({ username });
  });

  const dummyHash = await hashPassword(randomBytes(16).toString('hex'));
  app.post('/api/admin/login', {
    config: { ...rateLimit(context.config.rateLimits.login.max, context.config.rateLimits.login.windowMinutes), writesData: false },
    schema: {
      operationId: 'login', tags: ['auth'], summary: 'Signs the admin in and sets the session cookie.',
      security: SECURITY.csrf,
      body: Type.Object({
        username: Type.String({ maxLength: MAX_USERNAME_LENGTH }),
        password: Type.String({ maxLength: MAX_PASSWORD_LENGTH }),
      }, { additionalProperties: false }),
      response: { 200: UsernameSchema, ...errorResponses },
    },
  }, async (request, reply) => {
    requireCsrfHeader(request);
    const admin = getAdmin(context.db);
    warnPlainHttpCredentials(request);
    const passwordOk = await checkAdminPassword(request.log, request.body.password, admin?.password_hash ?? dummyHash);
    const usernameOk = admin !== null && secretsEqual(request.body.username.trim(), admin.username);
    if (!admin || !passwordOk || !usernameOk) {
      throw new HttpError(401, 'invalid_credentials', 'The username or password is incorrect.');
    }
    setAudit(request, { actorType: 'admin', actor: admin.username });
    startSession(context, request, reply);
    return { username: admin.username };
  });

  await app.register(async (admin) => registerAdminRoutes(admin, context));

  // ------------------------------------------------------------- built SPA

  const staticDir = options.staticDir;
  if (staticDir && existsSync(path.join(staticDir, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: staticDir,
      index: false,
      wildcard: true,
      setHeaders: (response, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          response.header('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          response.header('Cache-Control', NO_STORE);
        }
      },
    });
    app.get('/', (_request, reply) => reply.header('Cache-Control', NO_STORE).sendFile('index.html'));
    app.get('/admin', (_request, reply) => reply.header('Cache-Control', NO_STORE).sendFile('admin.html'));
    app.get('/admin/', (_request, reply) => reply.redirect('/admin'));
  }

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({ error: 'not_found', message: `${request.method} ${request.url.split('?')[0]} was not found.` });
  });

  return app;
}
