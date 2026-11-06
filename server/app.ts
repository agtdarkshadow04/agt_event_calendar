import { randomBytes } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import Fastify from 'fastify';
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from 'fastify';
import type { ApiEvent, PublicSettings } from '../src/lib/api';
import { isLegacyEventId, isUuidV4, validateAgtUsername, validateEventInput } from '../src/lib/validation';
import { registerAdminRoutes } from './adminRoutes';
import { createAltchaChallenge, verifyAltchaPayload } from './altcha';
import type { AppContext } from './context';
import { setting } from './context';
import { HttpError, readMultipart } from './http';
import { endSession, hasValidSession, requireCsrfHeader, startSession } from './session';
import { ImageRejectedError, removeImageFile, validateImage, writeImageFile } from './images';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, hashPassword, secretsEqual, verifyPassword } from './passwords';
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
  "style-src 'self' 'unsafe-inline'",
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
  logger?: boolean | FastifyBaseLogger | Record<string, unknown>;
  /** Directory with the built SPA (`dist/`). Skipped when it does not exist. */
  staticDir?: string;
}

const ApiEventSchema = Type.Object({
  id: Type.String(),
  legacyId: Type.Union([Type.String(), Type.Null()]),
  name: Type.String(),
  start: Type.String(),
  end: Type.Union([Type.String(), Type.Null()]),
  civilization: Type.Union([Type.String(), Type.Null()]),
  type: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  coverImageId: Type.Union([Type.String(), Type.Null()]),
  links: Type.Array(Type.String()),
  galaxy: Type.String(),
  region: Type.String(),
  system: Type.String(),
  planet: Type.Union([Type.String(), Type.Null()]),
  portalCode: Type.String(),
}, { additionalProperties: false });

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

const rateLimit = (max: number | ((request: FastifyRequest) => number), windowMinutes: number | ((request: FastifyRequest) => number)) => ({
  rateLimit: {
    max,
    timeWindow: typeof windowMinutes === 'number'
      ? windowMinutes * 60_000
      : (request: FastifyRequest) => windowMinutes(request) * 60_000,
  },
});

export async function buildApp(context: AppContext, options: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: context.config.trustProxy,
    bodyLimit: 2 * 1024 * 1024,
  }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(fastifyCookie);
  await app.register(fastifyMultipart, { throwFileSizeLimit: true });
  await app.register(fastifyRateLimit, {
    global: false,
    errorResponseBuilder: (_request, rate) => ({
      statusCode: 429,
      error: 'rate_limited',
      message: `Too many requests. Try again in ${Math.ceil(rate.ttl / 1000)} seconds.`,
    }),
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

  app.setErrorHandler((error: Error & { statusCode?: number; code?: string; validation?: unknown }, request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({ error: error.code, message: error.message, fields: error.fields });
    }
    if (error instanceof ImageRejectedError) {
      return reply.status(error.statusCode).send({ error: 'image_rejected', message: error.message });
    }
    if (error instanceof ZipRejectedError) {
      return reply.status(422).send({ error: 'archive_rejected', message: error.message });
    }
    if (error.validation) {
      return reply.status(400).send({ error: 'invalid_request', message: error.message });
    }
    if (error.code === 'FST_REQ_FILE_TOO_LARGE' || error.statusCode === 413) {
      return reply.status(413).send({ error: 'file_too_large', message: 'The upload is too large.' });
    }
    if (error.statusCode === 429) {
      return reply.status(429).send({ error: 'rate_limited', message: error.message });
    }
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: error.code ?? 'bad_request', message: error.message });
    }
    request.log.error(error);
    return reply.status(500).send({ error: 'internal', message: 'An unexpected server error occurred.' });
  });

  // ------------------------------------------------------------- public API

  app.get('/api/health', async () => {
    context.db.prepare('SELECT 1').get();
    return { status: 'ok' };
  });

  app.get('/api/settings/public', async () => publicSettings(context));

  app.get('/api/events', { schema: { response: { 200: Type.Array(ApiEventSchema) } } }, async () =>
    listEvents(context.db, ['published']).map(toPublicEvent));

  app.get('/api/events/:id', {
    schema: { params: Type.Object({ id: Type.String({ maxLength: 64 }) }), response: { 200: ApiEventSchema } },
  }, async (request) => {
    const { id } = request.params;
    const event = isUuidV4(id) ? getEvent(context.db, id) : isLegacyEventId(id) ? getEventByLegacyId(context.db, id) : null;
    if (!event || event.status !== 'published') throw new HttpError(404, 'not_found', 'Event not found.');
    return toPublicEvent(event);
  });

  app.get('/api/holidays', async () =>
    listHolidays(context.db, true).map(({ published: _published, ...holiday }) => holiday));

  app.get('/api/changelog', async () =>
    listChangeLog(context.db, true).map(({ published: _published, ...entry }) => entry));

  app.get('/api/images/:id', {
    schema: { params: Type.Object({ id: Type.String({ maxLength: 64 }) }) },
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
    return reply.send(createReadStream(filePath));
  });

  // ------------------------------------------------------------- submissions

  const submissionsEnabled = () => setting(context, 'submissions.enabled');
  const assertSubmissionsOpen = () => {
    if (!submissionsEnabled()) {
      throw new HttpError(403, 'submissions_closed', 'Event submissions are currently closed by the administrator.');
    }
  };

  app.get('/api/altcha/challenge', { config: rateLimit(60, 1) }, async () => {
    assertSubmissionsOpen();
    return createAltchaChallenge(context);
  });

  app.post('/api/submissions', {
    config: rateLimit(
      () => setting(context, 'submissions.rateLimit.max'),
      () => setting(context, 'submissions.rateLimit.windowMinutes'),
    ),
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
    request.log.info({ eventId: id }, 'Event submitted for moderation');
    return reply.status(201).send({ id, status: 'pending' });
  });

  // ------------------------------------------------------------- first-run setup & auth

  app.get('/api/setup/status', async () => ({
    adminExists: getAdmin(context.db) !== null,
    setupPasswordConfigured: Boolean(context.setupPassword),
  }));

  app.post('/api/setup', {
    config: rateLimit(context.config.rateLimits.setup.max, context.config.rateLimits.setup.windowMinutes),
    schema: {
      body: Type.Object({
        setupPassword: Type.String({ maxLength: MAX_PASSWORD_LENGTH }),
        username: Type.String({ maxLength: 64 }),
        password: Type.String({ maxLength: MAX_PASSWORD_LENGTH }),
      }, { additionalProperties: false }),
    },
  }, async (request, reply) => {
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
    const fields = [];
    if (!username) fields.push({ field: 'username', message: 'Choose an admin username.' });
    if (password.length < MIN_PASSWORD_LENGTH) {
      fields.push({ field: 'password', message: `The admin password must have at least ${MIN_PASSWORD_LENGTH} characters.` });
    }
    if (secretsEqual(password, context.setupPassword)) {
      fields.push({ field: 'password', message: 'Choose a new admin password; the setup password cannot be reused.' });
    }
    if (fields.length > 0) throw new HttpError(400, 'validation_failed', fields[0].message, fields);
    if (!createAdmin(context.db, username, await hashPassword(password))) {
      throw new HttpError(410, 'setup_complete', 'The admin account already exists. First-run setup is disabled.');
    }
    request.log.warn('Admin account created. Remove AGT_SETUP_PASSWORD from .env and restart the container.');
    startSession(context, request, reply);
    return reply.status(201).send({ username });
  });

  const dummyHash = await hashPassword(randomBytes(16).toString('hex'));
  app.post('/api/admin/login', {
    config: rateLimit(context.config.rateLimits.login.max, context.config.rateLimits.login.windowMinutes),
    schema: {
      body: Type.Object({
        username: Type.String({ maxLength: 64 }),
        password: Type.String({ maxLength: MAX_PASSWORD_LENGTH }),
      }, { additionalProperties: false }),
    },
  }, async (request, reply) => {
    requireCsrfHeader(request);
    const admin = getAdmin(context.db);
    const passwordOk = await verifyPassword(request.body.password, admin?.password_hash ?? dummyHash);
    const usernameOk = admin !== null && secretsEqual(request.body.username.trim(), admin.username);
    if (!admin || !passwordOk || !usernameOk) {
      throw new HttpError(401, 'invalid_credentials', 'The username or password is incorrect.');
    }
    startSession(context, request, reply);
    return { username: admin.username };
  });

  app.post('/api/admin/logout', async (request, reply) => {
    requireCsrfHeader(request);
    endSession(context, request, reply);
    return { ok: true };
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
