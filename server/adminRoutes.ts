import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { EVENT_STATUSES, isUuidV4, validateChangeLogInput, validateEventInput, validateHolidayInput } from '../src/lib/validation';
import type { EventStatus } from '../src/lib/validation';
import { fieldError } from '../src/lib/errors';
import { changedFields, setAudit } from './audit';
import { CSRF_HEADER, endSession, hasValidSession, recoverySessionOf, requireCsrfHeader, startSession } from './session';
import { discardBackup, downloadBackup, previewRestore, restoreBackup } from './backup';
import { EDITABLE_SETTINGS, SETTING_KEYS } from './config';
import type { SettingKey } from './config';
import type { AppContext } from './context';
import { isDefinedInConfig, setting, settingOrDefault, settingStates } from './context';
import { HttpError, readMultipart } from './http';
import { removeImageFile, validateImage, writeImageFile } from './images';
import { registerLogRoutes } from './logRoutes';
import { migrateFromAmplify } from './migration';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, checkAdminPassword, hashPassword } from './passwords';
import { SECURITY, errorResponses } from './openapi';
import {
  deleteAllSessions, deleteChangeLog, deleteEvent, deleteHoliday, deleteImageRow, deleteSetting, getAdmin, getChangeLog,
  getEvent, getHoliday, getImage, insertChangeLog, insertEvent, insertHoliday, insertImage, listChangeLog, listEvents,
  listHolidays, listImages, replaceImageRow, setEventStatus, setSetting, unreferencedImages, updateAdminPassword,
  updateChangeLog, updateEvent, updateHoliday,
} from './repository';
import {
  AdminApiChangeLogEntrySchema, AdminApiEventSchema, AdminApiHolidaySchema, AdminChangeLogResultSchema,
  AdminEventInputSchema, AdminEventResultSchema, AdminHolidayResultSchema, AdminImageSchema, binaryResponse,
  ChangeLogInputSchema, EventStatusSchema, HolidayInputSchema, IdParams, ImageResultSchema, MigrationFormSchema,
  MigrationReportSchema, NoContent, OkSchema, RestoreFormSchema, RestoreReportSchema, SessionSchema, SettingStateSchema,
  SettingsUpdateSchema,
} from './schemas';

const ImageFormSchema = Type.Object({
  file: Type.String({ format: 'binary', description: 'PNG, JPEG, WebP or GIF image (no SVG).' }),
});

/** OpenAPI metadata shared by admin routes. */
const read = (operationId: string, tags: string[], summary: string) =>
  ({ operationId, tags, summary, security: SECURITY.adminRead });
const write = (operationId: string, tags: string[], summary: string) =>
  ({ operationId, tags, summary, security: SECURITY.adminWrite });

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
      fieldError('coverImageId', 'image_not_found', 'Cover image'),
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

/** Admin-only API. Every route requires a valid session; mutations also require the CSRF header. */
export async function registerAdminRoutes(fastify: FastifyInstance, context: AppContext): Promise<void> {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  app.addHook('onRequest', async (request: FastifyRequest) => {
    if (!request.url.startsWith('/api/admin/')) return;
    if (request.method !== 'GET' && request.method !== 'HEAD') requireCsrfHeader(request);
    if (!hasValidSession(context, request)) throw new HttpError(401, 'unauthorized', 'Sign in as the admin to continue.');
  });

  // ------------------------------------------------------------- account

  app.get('/api/admin/session', {
    config: { writesData: false },
    schema: {
      ...read('getSession', ['admin'], 'Returns the signed-in admin, whether the setup password is still set, and the app version.'),
      response: { 200: SessionSchema, ...errorResponses },
    },
  }, async () => ({
    // While a restore is failed, only the recovery session gets here, and the data is not read (BAK-11).
    username: context.operation.state === 'restore_failed'
      ? context.operation.recovery?.username ?? null
      : getAdmin(context.db)?.username ?? null,
    setupPasswordStillSet: Boolean(context.setupPassword),
    csrfHeader: CSRF_HEADER,
    version: context.version,
  }));

  app.post('/api/admin/password', {
    schema: {
      ...write('changePassword', ['admin'], 'Changes the admin password and ends all other sessions.'),
      body: Type.Object({
        currentPassword: Type.String({ maxLength: MAX_PASSWORD_LENGTH }),
        newPassword: Type.String({ maxLength: MAX_PASSWORD_LENGTH }),
      }, { additionalProperties: false }),
      response: { 200: OkSchema, ...errorResponses },
    },
    config: { writesData: true, rateLimit: { max: context.config.rateLimits.login.max, timeWindow: context.config.rateLimits.login.windowMinutes * 60_000 } },
  }, async (request, reply) => {
    const admin = getAdmin(context.db);
    if (!admin || !(await checkAdminPassword(request.log, request.body.currentPassword, admin.password_hash))) {
      throw new HttpError(401, 'invalid_credentials', 'The current password is incorrect.');
    }
    if (request.body.newPassword.length < MIN_PASSWORD_LENGTH) {
      const error = fieldError('newPassword', 'too_short', 'The new password', { min: MIN_PASSWORD_LENGTH });
      throw new HttpError(400, 'validation_failed', error.message, [error]);
    }
    updateAdminPassword(context.db, await hashPassword(request.body.newPassword));
    deleteAllSessions(context.db);
    setAudit(request, { targetType: 'admin' });
    startSession(context, request, reply);
    return { ok: true as const };
  });

  // ------------------------------------------------------------- events

  app.get('/api/admin/events', {
    config: { writesData: false },
    schema: {
      ...read('listAdminEvents', ['events'], 'Lists all events, optionally filtered by status.'),
      querystring: Type.Object({ status: Type.Optional(EventStatusSchema) }, { additionalProperties: false }),
      response: { 200: Type.Array(AdminApiEventSchema), ...errorResponses },
    },
  }, async (request) => listEvents(context.db, request.query.status ? [request.query.status] : undefined));

  app.get('/api/admin/events/:id', {
    config: { writesData: false },
    schema: {
      ...read('getAdminEvent', ['events'], 'Returns any event, whatever its status.'),
      params: IdParams,
      response: { 200: AdminApiEventSchema, ...errorResponses },
    },
  }, async (request) => getEvent(context.db, checkUuid(request.params.id, 'Event')) ?? notFound('Event'));

  app.post('/api/admin/events', {
    config: { writesData: true },
    schema: {
      ...write('createAdminEvent', ['events'], 'Creates an event (unpublished unless a status is given).'),
      body: AdminEventInputSchema,
      response: { 201: AdminEventResultSchema, ...errorResponses },
    },
  }, async (request, reply) => {
    const result = validateEventInput(request.body);
    if (!result.ok) throw new HttpError(400, 'validation_failed', 'The event is invalid.', result.errors);
    const status = statusFrom(request.body.status, 'unpublished');
    const id = insertEvent(context.db, result.value, { status, coverImageId: coverImageIdFrom(context, request.body) });
    const event = getEvent(context.db, id)!;
    setAudit(request, { targetType: 'event', targetId: id, details: { name: event.name, status, fields: Object.keys(request.body).sort() } });
    return reply.status(201).send({ event, notices: result.notices });
  });

  app.put('/api/admin/events/:id', {
    config: { writesData: true },
    schema: {
      ...write('updateAdminEvent', ['events'], 'Replaces an event; the status changes only when given.'),
      params: IdParams,
      body: AdminEventInputSchema,
      response: { 200: AdminEventResultSchema, ...errorResponses },
    },
  }, async (request) => {
    const id = checkUuid(request.params.id, 'Event');
    const existing = getEvent(context.db, id) ?? notFound('Event');
    const result = validateEventInput(request.body);
    if (!result.ok) throw new HttpError(400, 'validation_failed', 'The event is invalid.', result.errors);
    const coverImageId = coverImageIdFrom(context, request.body);
    context.db.transaction(() => {
      updateEvent(context.db, id, result.value, coverImageId);
      if (request.body.status !== undefined) setEventStatus(context.db, id, statusFrom(request.body.status, existing.status));
    })();
    const event = getEvent(context.db, id)!;
    setAudit(request, { targetType: 'event', targetId: id, details: { name: event.name, changedFields: changedFields(existing, event) } });
    return { event, notices: result.notices };
  });

  app.post('/api/admin/events/:id/status', {
    config: { writesData: true },
    schema: {
      ...write('setAdminEventStatus', ['events'], 'Publishes, unpublishes, approves or rejects an event.'),
      params: IdParams,
      body: Type.Object({ status: EventStatusSchema }, { additionalProperties: false }),
      response: { 200: AdminEventResultSchema, ...errorResponses },
    },
  }, async (request) => {
    const id = checkUuid(request.params.id, 'Event');
    const existing = getEvent(context.db, id) ?? notFound('Event');
    if (!setEventStatus(context.db, id, request.body.status)) notFound('Event');
    setAudit(request, { targetType: 'event', targetId: id, details: { name: existing.name, from: existing.status, to: request.body.status } });
    return { event: getEvent(context.db, id)!, notices: [] };
  });

  app.delete('/api/admin/events/:id', {
    config: { writesData: true },
    schema: {
      ...write('deleteAdminEvent', ['events'], 'Deletes an event.'),
      params: IdParams,
      response: { 204: NoContent, ...errorResponses },
    },
  }, async (request, reply) => {
    const id = checkUuid(request.params.id, 'Event');
    const existing = getEvent(context.db, id) ?? notFound('Event');
    if (!deleteEvent(context.db, id)) notFound('Event');
    setAudit(request, { targetType: 'event', targetId: id, details: { name: existing.name, status: existing.status } });
    return reply.status(204).send(null);
  });

  // ------------------------------------------------------------- images

  app.get('/api/admin/images', {
    config: { writesData: false },
    schema: {
      ...read('listAdminImages', ['images'], 'Lists uploaded images with the events that use them.'),
      response: { 200: Type.Array(AdminImageSchema), ...errorResponses },
    },
  }, async () => listImages(context.db));

  const imageUpload = async (request: FastifyRequest) => {
    const maxBytes = setting(context, 'uploads.maxImageBytes');
    const form = await readMultipart(request, { fileFields: ['file'], maxFileBytes: maxBytes });
    const file = form.files.get('file');
    if (!file?.data) throw new HttpError(400, 'file_required', 'Choose an image file to upload.');
    const mime = validateImage(file.data, { maxBytes, declaredMime: file.mimeType, fileName: file.fileName });
    return writeImageFile(context.config.uploadsDir, file.data, mime);
  };
  const uploadConfig = {
    rateLimit: {
      max: context.config.rateLimits.adminUploads.max,
      timeWindow: context.config.rateLimits.adminUploads.windowMinutes * 60_000,
    },
    multipartBody: ImageFormSchema,
  };

  app.post('/api/admin/images', {
    config: { ...uploadConfig, writesData: true },
    schema: {
      ...write('uploadAdminImage', ['images'], 'Uploads an image, checked by its contents.'),
      response: { 201: ImageResultSchema, ...errorResponses },
    },
  }, async (request, reply) => {
    const image = await imageUpload(request);
    try {
      insertImage(context.db, image);
    } catch (error) {
      removeImageFile(context.config.uploadsDir, image.fileName);
      throw error;
    }
    setAudit(request, { targetType: 'image', targetId: image.id, details: { sizeBytes: image.sizeBytes, mimeType: image.mimeType } });
    return reply.status(201).send({ image });
  });

  app.put('/api/admin/images/:id', {
    config: { ...uploadConfig, writesData: true },
    schema: {
      ...write('replaceAdminImage', ['images'], 'Replaces the file of an image, keeping its ID.'),
      params: IdParams,
      response: { 200: ImageResultSchema, ...errorResponses },
    },
  }, async (request) => {
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
    setAudit(request, {
      targetType: 'image',
      targetId: id,
      details: {
        sizeBytes: replacement.sizeBytes,
        mimeType: replacement.mimeType,
        previous: { sizeBytes: existing.sizeBytes, mimeType: existing.mimeType },
      },
    });
    return { image: getImage(context.db, id)! };
  });

  app.delete('/api/admin/images/:id', {
    config: { writesData: true },
    schema: {
      ...write('deleteAdminImage', ['images'], 'Deletes an image; events using it lose their cover.'),
      params: IdParams,
      response: { 204: NoContent, ...errorResponses },
    },
  }, async (request, reply) => {
    const image = deleteImageRow(context.db, checkUuid(request.params.id, 'Image')) ?? notFound('Image');
    removeImageFile(context.config.uploadsDir, image.fileName);
    setAudit(request, { targetType: 'image', targetId: image.id, details: { sizeBytes: image.sizeBytes, mimeType: image.mimeType } });
    return reply.status(204).send(null);
  });

  app.post('/api/admin/images/cleanup', {
    config: { writesData: true },
    schema: {
      ...write('cleanUpAdminImages', ['images'], 'Deletes every image that no event uses.'),
      response: { 200: Type.Object({ removed: Type.Integer() }), ...errorResponses },
    },
  }, async (request) => {
    const removed = context.db.transaction(() => {
      const images = unreferencedImages(context.db);
      for (const image of images) deleteImageRow(context.db, image.id);
      return images;
    })();
    for (const image of removed) removeImageFile(context.config.uploadsDir, image.fileName);
    setAudit(request, {
      targetType: 'image',
      details: { removed: removed.length, bytes: removed.reduce((total, image) => total + image.sizeBytes, 0) },
    });
    return { removed: removed.length };
  });

  // ------------------------------------------------------------- national holidays

  app.get('/api/admin/holidays', {
    config: { writesData: false },
    schema: {
      ...read('listAdminHolidays', ['holidays'], 'Lists all national holidays.'),
      response: { 200: Type.Array(AdminApiHolidaySchema), ...errorResponses },
    },
  }, async () => listHolidays(context.db, false));

  app.post('/api/admin/holidays', {
    config: { writesData: true },
    schema: {
      ...write('createAdminHoliday', ['holidays'], 'Creates a national holiday (published unless stated otherwise).'),
      body: HolidayInputSchema,
      response: { 201: AdminHolidayResultSchema, ...errorResponses },
    },
  }, async (request, reply) => {
    const result = validateHolidayInput(request.body);
    if (!result.ok) throw new HttpError(400, 'validation_failed', 'The holiday is invalid.', result.errors);
    const id = insertHoliday(context.db, result.value, request.body.published ?? true);
    const holiday = getHoliday(context.db, id)!;
    setAudit(request, { targetType: 'holiday', targetId: id, details: { name: holiday.name, published: holiday.published, fields: Object.keys(request.body).sort() } });
    return reply.status(201).send({ holiday, notices: result.notices });
  });

  app.put('/api/admin/holidays/:id', {
    config: { writesData: true },
    schema: {
      ...write('updateAdminHoliday', ['holidays'], 'Replaces a national holiday.'),
      params: IdParams,
      body: HolidayInputSchema,
      response: { 200: AdminHolidayResultSchema, ...errorResponses },
    },
  }, async (request) => {
    const id = checkUuid(request.params.id, 'Holiday');
    const existing = getHoliday(context.db, id) ?? notFound('Holiday');
    const result = validateHolidayInput(request.body);
    if (!result.ok) throw new HttpError(400, 'validation_failed', 'The holiday is invalid.', result.errors);
    if (!updateHoliday(context.db, id, result.value, request.body.published ?? true)) notFound('Holiday');
    const holiday = getHoliday(context.db, id)!;
    setAudit(request, { targetType: 'holiday', targetId: id, details: { name: holiday.name, changedFields: changedFields(existing, holiday) } });
    return { holiday, notices: result.notices };
  });

  app.delete('/api/admin/holidays/:id', {
    config: { writesData: true },
    schema: {
      ...write('deleteAdminHoliday', ['holidays'], 'Deletes a national holiday.'),
      params: IdParams,
      response: { 204: NoContent, ...errorResponses },
    },
  }, async (request, reply) => {
    const id = checkUuid(request.params.id, 'Holiday');
    const existing = getHoliday(context.db, id) ?? notFound('Holiday');
    if (!deleteHoliday(context.db, id)) notFound('Holiday');
    setAudit(request, { targetType: 'holiday', targetId: id, details: { name: existing.name } });
    return reply.status(204).send(null);
  });

  // ------------------------------------------------------------- change log

  app.get('/api/admin/changelog', {
    config: { writesData: false },
    schema: {
      ...read('listAdminChangeLog', ['changelog'], 'Lists all change-log entries, newest first.'),
      response: { 200: Type.Array(AdminApiChangeLogEntrySchema), ...errorResponses },
    },
  }, async () => listChangeLog(context.db, false));

  app.post('/api/admin/changelog', {
    config: { writesData: true },
    schema: {
      ...write('createAdminChangeLogEntry', ['changelog'], 'Creates a change-log entry (published unless stated otherwise).'),
      body: ChangeLogInputSchema,
      response: { 201: AdminChangeLogResultSchema, ...errorResponses },
    },
  }, async (request, reply) => {
    const result = validateChangeLogInput(request.body);
    if (!result.ok) throw new HttpError(400, 'validation_failed', 'The change-log entry is invalid.', result.errors);
    const id = insertChangeLog(context.db, result.value, request.body.published ?? true);
    const entry = getChangeLog(context.db, id)!;
    setAudit(request, { targetType: 'changelog', targetId: id, details: { date: entry.date, published: entry.published, fields: Object.keys(request.body).sort() } });
    return reply.status(201).send({ changeLogEntry: entry, notices: result.notices });
  });

  app.put('/api/admin/changelog/:id', {
    config: { writesData: true },
    schema: {
      ...write('updateAdminChangeLogEntry', ['changelog'], 'Replaces a change-log entry.'),
      params: IdParams,
      body: ChangeLogInputSchema,
      response: { 200: AdminChangeLogResultSchema, ...errorResponses },
    },
  }, async (request) => {
    const id = checkUuid(request.params.id, 'Change-log entry');
    const existing = getChangeLog(context.db, id) ?? notFound('Change-log entry');
    const result = validateChangeLogInput(request.body);
    if (!result.ok) throw new HttpError(400, 'validation_failed', 'The change-log entry is invalid.', result.errors);
    if (!updateChangeLog(context.db, id, result.value, request.body.published ?? true)) notFound('Change-log entry');
    const entry = getChangeLog(context.db, id)!;
    setAudit(request, { targetType: 'changelog', targetId: id, details: { date: entry.date, changedFields: changedFields(existing, entry) } });
    return { changeLogEntry: entry, notices: result.notices };
  });

  app.delete('/api/admin/changelog/:id', {
    config: { writesData: true },
    schema: {
      ...write('deleteAdminChangeLogEntry', ['changelog'], 'Deletes a change-log entry.'),
      params: IdParams,
      response: { 204: NoContent, ...errorResponses },
    },
  }, async (request, reply) => {
    const id = checkUuid(request.params.id, 'Change-log entry');
    const existing = getChangeLog(context.db, id) ?? notFound('Change-log entry');
    if (!deleteChangeLog(context.db, id)) notFound('Change-log entry');
    setAudit(request, { targetType: 'changelog', targetId: id, details: { date: existing.date } });
    return reply.status(204).send(null);
  });

  // ------------------------------------------------------------- settings

  app.get('/api/admin/settings', {
    config: { writesData: false },
    schema: {
      ...read('listSettings', ['admin'], 'Lists dashboard settings with their effective value and source.'),
      response: { 200: Type.Array(SettingStateSchema), ...errorResponses },
    },
  }, async () => settingStates(context));

  /**
   * Updates dashboard settings. `null` resets a key to its default. The whole
   * request is rejected if any key is defined in config.yaml: the config file
   * always wins and is enforced here, not only in the UI.
   */
  app.put('/api/admin/settings', {
    config: { writesData: true },
    schema: {
      ...write('updateSettings', ['admin'],
        'Changes dashboard settings. Keys defined in config.yaml are rejected with 409 defined_in_config.'),
      body: SettingsUpdateSchema,
      response: { 200: Type.Array(SettingStateSchema), ...errorResponses },
    },
  }, async (request) => {
    const entries = Object.entries(request.body.values);
    for (const [key, value] of entries) {
      if (!(SETTING_KEYS as string[]).includes(key)) {
        throw new HttpError(400, 'unknown_setting', `${key} is not a setting that can be changed from the dashboard.`);
      }
      if (isDefinedInConfig(context, key)) {
        throw new HttpError(409, 'defined_in_config',
          `${key} is defined in the configuration file and cannot be changed from the dashboard.`, undefined, { key });
      }
      if (value !== null && !Value.Check(EDITABLE_SETTINGS[key as SettingKey].schema, value)) {
        throw new HttpError(400, 'invalid_setting', `${key} has an invalid value.`);
      }
    }
    const before = new Map(settingStates(context).map((state) => [state.key as string, state.value]));
    context.db.transaction(() => {
      for (const [key, value] of entries) {
        if (value === null) deleteSetting(context.db, key);
        else setSetting(context.db, key, value);
      }
    })();
    const after = settingStates(context);
    setAudit(request, {
      targetType: 'settings',
      details: {
        changes: entries.map(([key]) => ({
          key, old: before.get(key) ?? null, new: after.find((state) => state.key === key)?.value ?? null,
        })),
      },
    });
    return after;
  });

  // ------------------------------------------------------------- Migrate from Amplify

  app.post('/api/admin/migrate', {
    config: { writesData: true, multipartBody: MigrationFormSchema },
    schema: {
      ...write('migrateFromAmplify', ['backup'], 'Previews or imports a Migrate from Amplify ZIP.'),
      response: { 200: MigrationReportSchema, ...errorResponses },
    },
  }, async (request) => {
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
      setAudit(request, {
        targetType: 'migration',
        details: {
          mode,
          onExisting,
          fileSizeBytes: statSync(file.path).size,
          events: {
            toCreate: report.events.toCreate, toOverwrite: report.events.toOverwrite,
            alreadyMigrated: report.events.alreadyMigrated, skipped: report.events.skipped,
          },
          holidays: report.holidays,
          descriptionsStored: report.descriptionsStored,
          coversStored: report.coversStored,
          errors: report.errors.length,
          warnings: report.warnings.length,
          missingFiles: report.missingFiles.length,
        },
      });
      return report;
    } finally {
      form.cleanup();
    }
  });

  // ------------------------------------------------------------- backup & restore

  app.get('/api/admin/backup', {
    config: { writesData: false, audit: true },
    schema: {
      ...read('downloadBackup', ['backup'], 'Downloads a backup ZIP (database, uploads, config.yaml, manifest).'),
      response: { 200: binaryResponse('The backup ZIP.', ['application/zip']), ...errorResponses },
    },
  }, async (request, reply) => {
    const backup = await downloadBackup(context);
    const stream = createReadStream(backup.path);
    stream.on('close', () => discardBackup(backup.path));
    setAudit(request, { targetType: 'backup', details: { fileName: backup.fileName, sizeBytes: statSync(backup.path).size } });
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${path.basename(backup.fileName)}"`);
    // A stream is sent as is; the response schema only documents it.
    return reply.send(stream as unknown as string);
  });

  app.post('/api/admin/restore', {
    config: { writesData: false, multipartBody: RestoreFormSchema },
    schema: {
      ...write('restoreBackup', ['backup'],
        'Previews or restores a backup. A restore replaces all data and the admin account, and ends every session.'),
      response: { 200: RestoreReportSchema, ...errorResponses },
    },
  }, async (request, reply) => {
    const form = await readMultipart(request, {
      fileFields: ['backup'],
      maxFileBytes: settingOrDefault(context, 'migration.maxZipBytes'),
      toDisk: context.config.backupsDir,
    });
    try {
      const file = form.files.get('backup');
      if (!file?.path) throw new HttpError(400, 'file_required', 'Choose the backup ZIP file to upload.');
      const action = form.fields.action ?? 'preview';
      if (action !== 'preview' && action !== 'restore') throw new HttpError(400, 'invalid_request', 'action must be preview or restore.');
      setAudit(request, { targetType: 'backup', details: { action, fileSizeBytes: statSync(file.path).size } });
      const report = action === 'preview' ? await previewRestore(context, file.path) : await restoreBackup(context, file.path, {
          ownActivity: 1,
          // Recorded when the restore starts; a recovery restore keeps the one already recorded (BAK-11).
          session: context.operation.state === 'restore_failed' ? null : recoverySessionOf(context, request),
          log: request.log,
        });
      setAudit(request, {
        details: {
          backupCreatedAt: report.createdAt,
          backupAppVersion: report.appVersion,
          upgradedFromSchemaVersion: report.upgradedFromSchemaVersion,
          counts: report.counts,
          ignoredSettings: report.ignoredSettings.map((item) => item.key),
          droppedFiles: report.droppedFiles.length,
          configIncluded: report.config.included,
          preRestoreBackup: report.preRestoreBackup,
          warnings: report.warnings.length,
        },
      });
      if (action === 'restore') endSession(context, request, reply);
      return report;
    } finally {
      form.cleanup();
    }
  });

  // ------------------------------------------------------------- logs

  registerLogRoutes(app, context);
}
