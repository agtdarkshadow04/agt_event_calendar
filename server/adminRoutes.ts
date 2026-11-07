import { createReadStream } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { EVENT_STATUSES, isUuidV4, validateChangeLogInput, validateEventInput, validateHolidayInput } from '../src/lib/validation';
import type { EventStatus } from '../src/lib/validation';
import { CSRF_HEADER, endSession, hasValidSession, requireCsrfHeader, startSession } from './session';
import { createBackup, discardBackup, previewRestore, restoreBackup } from './backup';
import { EDITABLE_SETTINGS, SETTING_KEYS } from './config';
import type { SettingKey } from './config';
import type { AppContext } from './context';
import { isDefinedInConfig, setting, settingStates } from './context';
import { HttpError, readMultipart } from './http';
import { removeImageFile, validateImage, writeImageFile } from './images';
import { migrateFromAmplify } from './migration';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, hashPassword, verifyPassword } from './passwords';
import {
  deleteAllSessions, deleteChangeLog, deleteEvent, deleteHoliday, deleteImageRow, deleteSetting, getAdmin, getEvent,
  getImage, insertChangeLog, insertEvent, insertHoliday, insertImage, listChangeLog, listEvents, listHolidays,
  listImages, replaceImageRow, setEventStatus, setSetting, unreferencedImages, updateAdminPassword, updateChangeLog,
  updateEvent, updateHoliday,
} from './repository';

const IdParams = Type.Object({ id: Type.String({ maxLength: 64 }) });
const AnyObject = Type.Record(Type.String(), Type.Unknown());

function notFound(what: string): never {
  throw new HttpError(404, 'not_found', `${what} not found.`);
}

function checkUuid(id: string, what: string): string {
  if (!isUuidV4(id)) notFound(what);
  return id.toLowerCase();
}

function coverImageIdFrom(context: AppContext, body: Record<string, unknown>): string | null {
  const value = body.coverImageId;
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !isUuidV4(value) || !getImage(context.db, value.toLowerCase())) {
    throw new HttpError(400, 'validation_failed', 'The selected cover image does not exist.', [
      { field: 'coverImageId', message: 'The selected cover image does not exist.' },
    ]);
  }
  return value.toLowerCase();
}

function statusFrom(value: unknown, fallback: EventStatus): EventStatus {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !(EVENT_STATUSES as readonly string[]).includes(value)) {
    throw new HttpError(400, 'invalid_status', `Status must be one of: ${EVENT_STATUSES.join(', ')}.`);
  }
  return value as EventStatus;
}

function publishedFrom(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== 'boolean') throw new HttpError(400, 'invalid_request', 'published must be true or false.');
  return value;
}

/** Admin-only API. Every route requires a valid session; mutations also require the CSRF header. */
export async function registerAdminRoutes(fastify: FastifyInstance, context: AppContext): Promise<void> {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  app.addHook('onRequest', async (request: FastifyRequest) => {
    if (!request.url.startsWith('/api/admin/')) return;
    if (request.method !== 'GET' && request.method !== 'HEAD') requireCsrfHeader(request);
    if (!hasValidSession(context, request)) throw new HttpError(401, 'unauthorized', 'Sign in as the admin to continue.');
  });

  // ------------------------------------------------------------- account

  app.get('/api/admin/session', async () => ({
    username: getAdmin(context.db)?.username ?? null,
    setupPasswordStillSet: Boolean(context.setupPassword),
    csrfHeader: CSRF_HEADER,
  }));

  app.post('/api/admin/password', {
    schema: {
      body: Type.Object({
        currentPassword: Type.String({ maxLength: MAX_PASSWORD_LENGTH }),
        newPassword: Type.String({ maxLength: MAX_PASSWORD_LENGTH }),
      }, { additionalProperties: false }),
    },
    config: { rateLimit: { max: context.config.rateLimits.login.max, timeWindow: context.config.rateLimits.login.windowMinutes * 60_000 } },
  }, async (request, reply) => {
    const admin = getAdmin(context.db);
    if (!admin || !(await verifyPassword(request.body.currentPassword, admin.password_hash))) {
      throw new HttpError(401, 'invalid_credentials', 'The current password is incorrect.');
    }
    if (request.body.newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new HttpError(400, 'validation_failed', `The new password must have at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    updateAdminPassword(context.db, await hashPassword(request.body.newPassword));
    deleteAllSessions(context.db);
    startSession(context, request, reply);
    return { ok: true };
  });

  // ------------------------------------------------------------- events

  app.get('/api/admin/events', {
    schema: { querystring: Type.Object({ status: Type.Optional(Type.String()) }) },
  }, async (request) => {
    const status = request.query.status ? statusFrom(request.query.status, 'published') : null;
    return listEvents(context.db, status ? [status] : undefined);
  });

  app.get('/api/admin/events/:id', { schema: { params: IdParams } }, async (request) =>
    getEvent(context.db, checkUuid(request.params.id, 'Event')) ?? notFound('Event'));

  app.post('/api/admin/events', { schema: { body: AnyObject } }, async (request, reply) => {
    const result = validateEventInput(request.body);
    if (!result.ok) throw new HttpError(400, 'validation_failed', 'The event is invalid.', result.errors);
    const status = statusFrom(request.body.status, 'unpublished');
    const id = insertEvent(context.db, result.value, { status, coverImageId: coverImageIdFrom(context, request.body) });
    return reply.status(201).send({ event: getEvent(context.db, id), notices: result.notices });
  });

  app.put('/api/admin/events/:id', { schema: { params: IdParams, body: AnyObject } }, async (request) => {
    const id = checkUuid(request.params.id, 'Event');
    const existing = getEvent(context.db, id) ?? notFound('Event');
    const result = validateEventInput(request.body);
    if (!result.ok) throw new HttpError(400, 'validation_failed', 'The event is invalid.', result.errors);
    const coverImageId = coverImageIdFrom(context, request.body);
    context.db.transaction(() => {
      updateEvent(context.db, id, result.value, coverImageId);
      if (request.body.status !== undefined) setEventStatus(context.db, id, statusFrom(request.body.status, existing.status));
    })();
    return { event: getEvent(context.db, id), notices: result.notices };
  });

  app.post('/api/admin/events/:id/status', {
    schema: { params: IdParams, body: Type.Object({ status: Type.String() }, { additionalProperties: false }) },
  }, async (request) => {
    const id = checkUuid(request.params.id, 'Event');
    if (!setEventStatus(context.db, id, statusFrom(request.body.status, 'published'))) notFound('Event');
    return { event: getEvent(context.db, id) };
  });

  app.delete('/api/admin/events/:id', { schema: { params: IdParams } }, async (request) => {
    if (!deleteEvent(context.db, checkUuid(request.params.id, 'Event'))) notFound('Event');
    return { ok: true };
  });

  // ------------------------------------------------------------- images

  app.get('/api/admin/images', async () => listImages(context.db));

  const imageUpload = async (request: FastifyRequest) => {
    const maxBytes = setting(context, 'uploads.maxImageBytes');
    const form = await readMultipart(request, { fileFields: ['file'], maxFileBytes: maxBytes });
    const file = form.files.get('file');
    if (!file?.data) throw new HttpError(400, 'file_required', 'Choose an image file to upload.');
    const mime = validateImage(file.data, { maxBytes, declaredMime: file.mimeType, fileName: file.fileName });
    return writeImageFile(context.config.uploadsDir, file.data, mime);
  };
  const uploadLimit = {
    rateLimit: {
      max: context.config.rateLimits.adminUploads.max,
      timeWindow: context.config.rateLimits.adminUploads.windowMinutes * 60_000,
    },
  };

  app.post('/api/admin/images', { config: uploadLimit }, async (request, reply) => {
    const image = await imageUpload(request);
    try {
      insertImage(context.db, image);
    } catch (error) {
      removeImageFile(context.config.uploadsDir, image.fileName);
      throw error;
    }
    return reply.status(201).send({ image });
  });

  app.put('/api/admin/images/:id', { schema: { params: IdParams }, config: uploadLimit }, async (request) => {
    const id = checkUuid(request.params.id, 'Image');
    const existing = getImage(context.db, id) ?? notFound('Image');
    const replacement = await imageUpload(request);
    try {
      replaceImageRow(context.db, id, replacement);
    } catch (error) {
      removeImageFile(context.config.uploadsDir, replacement.fileName);
      throw error;
    }
    removeImageFile(context.config.uploadsDir, existing.fileName);
    return { image: getImage(context.db, id) };
  });

  app.delete('/api/admin/images/:id', { schema: { params: IdParams } }, async (request) => {
    const image = deleteImageRow(context.db, checkUuid(request.params.id, 'Image')) ?? notFound('Image');
    removeImageFile(context.config.uploadsDir, image.fileName);
    return { ok: true };
  });

  app.post('/api/admin/images/cleanup', async () => {
    const removed = context.db.transaction(() => {
      const images = unreferencedImages(context.db);
      for (const image of images) deleteImageRow(context.db, image.id);
      return images;
    })();
    for (const image of removed) removeImageFile(context.config.uploadsDir, image.fileName);
    return { removed: removed.length };
  });

  // ------------------------------------------------------------- national holidays

  app.get('/api/admin/holidays', async () => listHolidays(context.db, false));

  app.post('/api/admin/holidays', { schema: { body: AnyObject } }, async (request, reply) => {
    const result = validateHolidayInput(request.body);
    if (!result.ok) throw new HttpError(400, 'validation_failed', 'The holiday is invalid.', result.errors);
    const id = insertHoliday(context.db, result.value, publishedFrom(request.body.published));
    return reply.status(201).send({ id });
  });

  app.put('/api/admin/holidays/:id', { schema: { params: IdParams, body: AnyObject } }, async (request) => {
    const result = validateHolidayInput(request.body);
    if (!result.ok) throw new HttpError(400, 'validation_failed', 'The holiday is invalid.', result.errors);
    if (!updateHoliday(context.db, request.params.id, result.value, publishedFrom(request.body.published))) notFound('Holiday');
    return { ok: true };
  });

  app.delete('/api/admin/holidays/:id', { schema: { params: IdParams } }, async (request) => {
    if (!deleteHoliday(context.db, request.params.id)) notFound('Holiday');
    return { ok: true };
  });

  // ------------------------------------------------------------- change log

  app.get('/api/admin/changelog', async () => listChangeLog(context.db, false));

  app.post('/api/admin/changelog', { schema: { body: AnyObject } }, async (request, reply) => {
    const result = validateChangeLogInput(request.body);
    if (!result.ok) throw new HttpError(400, 'validation_failed', 'The change-log entry is invalid.', result.errors);
    const id = insertChangeLog(context.db, result.value, publishedFrom(request.body.published));
    return reply.status(201).send({ id });
  });

  app.put('/api/admin/changelog/:id', { schema: { params: IdParams, body: AnyObject } }, async (request) => {
    const result = validateChangeLogInput(request.body);
    if (!result.ok) throw new HttpError(400, 'validation_failed', 'The change-log entry is invalid.', result.errors);
    if (!updateChangeLog(context.db, request.params.id, result.value, publishedFrom(request.body.published))) notFound('Change-log entry');
    return { ok: true };
  });

  app.delete('/api/admin/changelog/:id', { schema: { params: IdParams } }, async (request) => {
    if (!deleteChangeLog(context.db, request.params.id)) notFound('Change-log entry');
    return { ok: true };
  });

  // ------------------------------------------------------------- settings

  app.get('/api/admin/settings', async () => settingStates(context));

  /**
   * Updates dashboard settings. `null` resets a key to its default. The whole
   * request is rejected if any key is defined in config.yaml: the config file
   * always wins and is enforced here, not only in the UI.
   */
  app.put('/api/admin/settings', {
    schema: { body: Type.Object({ values: AnyObject }, { additionalProperties: false }) },
  }, async (request) => {
    const entries = Object.entries(request.body.values);
    for (const [key, value] of entries) {
      if (!(SETTING_KEYS as string[]).includes(key)) {
        throw new HttpError(400, 'unknown_setting', `${key} is not a setting that can be changed from the dashboard.`);
      }
      if (isDefinedInConfig(context, key)) {
        throw new HttpError(409, 'defined_in_config', `${key} is defined in the configuration file and cannot be changed from the dashboard.`);
      }
      if (value !== null && !Value.Check(EDITABLE_SETTINGS[key as SettingKey].schema, value)) {
        throw new HttpError(400, 'invalid_setting', `${key} has an invalid value.`);
      }
    }
    context.db.transaction(() => {
      for (const [key, value] of entries) {
        if (value === null) deleteSetting(context.db, key);
        else setSetting(context.db, key, value);
      }
    })();
    return settingStates(context);
  });

  // ------------------------------------------------------------- Migrate from Amplify

  app.post('/api/admin/migrate', async (request) => {
    const form = await readMultipart(request, {
      fileFields: ['zip'],
      maxFileBytes: setting(context, 'migration.maxZipBytes'),
      toDisk: context.config.backupsDir,
    });
    try {
      const file = form.files.get('zip');
      if (!file?.path) throw new HttpError(400, 'file_required', 'Choose the migration ZIP file to upload.');
      const mode = form.fields.mode ?? 'preview';
      if (mode !== 'preview' && mode !== 'commit') throw new HttpError(400, 'invalid_request', 'mode must be preview or commit.');
      const onExisting = form.fields.onExisting ?? 'skip';
      if (onExisting !== 'skip' && onExisting !== 'overwrite') {
        throw new HttpError(400, 'invalid_request', 'onExisting must be skip or overwrite.');
      }
      const report = await migrateFromAmplify(context, file.path, { dryRun: mode === 'preview', onExisting });
      request.log.info({ dryRun: report.dryRun, events: report.events.toCreate }, 'Migrate from Amplify');
      return report;
    } finally {
      form.cleanup();
    }
  });

  // ------------------------------------------------------------- backup & restore

  app.get('/api/admin/backup', async (request, reply) => {
    const backup = await createBackup(context);
    const stream = createReadStream(backup.path);
    stream.on('close', () => discardBackup(backup.path));
    request.log.info('Backup exported');
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${path.basename(backup.fileName)}"`);
    return reply.send(stream);
  });

  app.post('/api/admin/restore', async (request, reply) => {
    const form = await readMultipart(request, {
      fileFields: ['backup'],
      maxFileBytes: setting(context, 'migration.maxZipBytes'),
      toDisk: context.config.backupsDir,
    });
    try {
      const file = form.files.get('backup');
      if (!file?.path) throw new HttpError(400, 'file_required', 'Choose the backup ZIP file to upload.');
      const action = form.fields.action ?? 'preview';
      if (action === 'preview') return await previewRestore(context, file.path);
      if (action !== 'restore') throw new HttpError(400, 'invalid_request', 'action must be preview or restore.');
      const report = await restoreBackup(context, file.path);
      request.log.warn({ preRestoreBackup: report.preRestoreBackup }, 'Backup restored; all sessions ended');
      endSession(context, request, reply);
      return report;
    } finally {
      form.cleanup();
    }
  });
}
