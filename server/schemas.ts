/**
 * TypeBox schemas for every API request and response. Fastify uses them to
 * validate requests and serialize responses, and @fastify/swagger turns them
 * into the OpenAPI document at /api/openapi.json (see server/openapi.ts).
 *
 * Response schemas list every field: Fastify's serializer drops properties a
 * schema does not declare, which keeps internal fields out of public responses.
 * Request schemas only check shape; the shared rules in src/lib/validation.ts
 * still produce the per-field messages.
 */
import { Type } from '@sinclair/typebox';
import type { Static, TSchema } from '@sinclair/typebox';
import { EVENT_STATUSES } from '../src/lib/validation';

const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const Uuid = Type.String({ format: 'uuid', description: 'Lowercase RFC 9562 version 4 UUID.' });
const Timestamp = Type.String({ description: 'ISO 8601 UTC timestamp ending in Z.' });
const IsoDate = Type.String({ description: 'Date as YYYY-MM-DD.' });
/** Generous caps that only stop absurd payloads; the shared validators enforce the real limits. */
const ShortText = Type.String({ maxLength: 10_000 });

// ------------------------------------------------------------------ shared

export const FieldErrorSchema = Type.Object({ field: Type.String(), message: Type.String() });

export const ErrorBodySchema = Type.Object({
  error: Type.String({ description: 'Stable snake_case error code.' }),
  message: Type.String({ description: 'English, human-readable message.' }),
  fields: Type.Optional(Type.Array(FieldErrorSchema, { description: 'Per-field validation errors.' })),
}, { description: 'Error response.' });

export const OkSchema = Type.Object({ ok: Type.Literal(true) });
export const IdParams = Type.Object({ id: Type.String({ maxLength: 64 }) });
export const NoContent = Type.Null({ description: 'No content.' });
export const BinaryFile = Type.String({ format: 'binary' });

/** A binary success response with the given media types (errors stay JSON through the `default` response). */
export const binaryResponse = (description: string, mediaTypes: string[]) => ({
  description,
  content: Object.fromEntries(mediaTypes.map((mediaType) => [mediaType, { schema: BinaryFile }])),
});

// ------------------------------------------------------------------ events

export const EventStatusSchema = Type.Union([
  Type.Literal('published'), Type.Literal('unpublished'), Type.Literal('pending'), Type.Literal('rejected'),
]);
// Keep the schema in step with the shared list of statuses.
const statusesMatch: (typeof EVENT_STATUSES)[number] extends Static<typeof EventStatusSchema> ? true : false = true;
void statusesMatch;

const eventFields = {
  id: Uuid,
  legacyId: Nullable(Type.String({ description: 'Amplify-era 4-hex ID, kept only to resolve old links.' })),
  name: Type.String(),
  start: Timestamp,
  end: Nullable(Timestamp),
  civilization: Nullable(Type.String()),
  type: Type.String(),
  description: Nullable(Type.String({ description: 'Markdown, stored exactly as written.' })),
  coverImageId: Nullable(Uuid),
  links: Type.Array(Type.String()),
  galaxy: Type.String(),
  region: Type.String(),
  system: Type.String(),
  planet: Nullable(Type.String()),
  portalCode: Type.String(),
};

export const ApiEventSchema = Type.Object(eventFields, { additionalProperties: false });

export const AdminApiEventSchema = Type.Object({
  ...eventFields,
  status: EventStatusSchema,
  submitterAgtUsername: Nullable(Type.String()),
  createdAt: Timestamp,
  updatedAt: Timestamp,
}, { additionalProperties: false });

/** Event fields an author supplies. Shape only; validateEventInput() applies the rules. */
const eventInputFields = {
  name: ShortText,
  start: ShortText,
  end: Type.Optional(Nullable(ShortText)),
  civilization: Type.Optional(Nullable(ShortText)),
  type: ShortText,
  description: Type.Optional(Nullable(Type.String({ maxLength: 200_000 }))),
  links: Type.Optional(Type.Array(ShortText, { maxItems: 100 })),
  galaxy: ShortText,
  region: ShortText,
  system: ShortText,
  planet: Type.Optional(Nullable(ShortText)),
  portalCode: ShortText,
};

export const EventInputSchema = Type.Object(eventInputFields, { additionalProperties: false });

export const AdminEventInputSchema = Type.Object({
  ...eventInputFields,
  status: Type.Optional(EventStatusSchema),
  coverImageId: Type.Optional(Nullable(Type.String({ maxLength: 64 }))),
}, { additionalProperties: false });

export const AdminEventResultSchema = Type.Object({
  event: AdminApiEventSchema,
  notices: Type.Array(FieldErrorSchema),
});

// ------------------------------------------------------------------ holidays & change log

const holidayFields = { id: Uuid, name: Type.String(), civilization: Type.String(), date: IsoDate, type: Type.String() };
export const ApiHolidaySchema = Type.Object(holidayFields, { additionalProperties: false });
export const AdminApiHolidaySchema = Type.Object({ ...holidayFields, published: Type.Boolean() }, { additionalProperties: false });
export const HolidayInputSchema = Type.Object({
  name: ShortText,
  civilization: ShortText,
  date: ShortText,
  type: ShortText,
  published: Type.Optional(Type.Boolean({ default: true })),
}, { additionalProperties: false });
export const AdminHolidayResultSchema = Type.Object({ holiday: AdminApiHolidaySchema, notices: Type.Array(FieldErrorSchema) });

const changeLogFields = {
  id: Uuid,
  date: IsoDate,
  changes: Type.String({ description: 'Comma- or line-separated list of changes.' }),
};
export const ApiChangeLogEntrySchema = Type.Object(changeLogFields, { additionalProperties: false });
export const AdminApiChangeLogEntrySchema = Type.Object({ ...changeLogFields, published: Type.Boolean() }, { additionalProperties: false });
export const ChangeLogInputSchema = Type.Object({
  date: ShortText,
  changes: Type.String({ maxLength: 100_000 }),
  published: Type.Optional(Type.Boolean({ default: true })),
}, { additionalProperties: false });
export const AdminChangeLogResultSchema = Type.Object({
  changeLogEntry: AdminApiChangeLogEntrySchema,
  notices: Type.Array(FieldErrorSchema),
});

// ------------------------------------------------------------------ images

export const ImageSchema = Type.Object({
  id: Uuid,
  fileName: Type.String(),
  mimeType: Type.Union([
    Type.Literal('image/png'), Type.Literal('image/jpeg'), Type.Literal('image/webp'), Type.Literal('image/gif'),
  ]),
  sizeBytes: Type.Integer(),
  sha256: Type.String(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

export const AdminImageSchema = Type.Object({
  ...ImageSchema.properties,
  referencedBy: Type.Array(Type.Object({ id: Uuid, name: Type.String(), status: EventStatusSchema })),
});

export const ImageResultSchema = Type.Object({ image: ImageSchema });

// ------------------------------------------------------------------ settings

export const PublicSettingsSchema = Type.Object({
  siteTitle: Type.String(),
  supportUrl: Type.String(),
  glyphToolUrl: Type.String(),
  submissionsEnabled: Type.Boolean(),
  maxImageBytes: Type.Integer(),
});

export const SettingStateSchema = Type.Object({
  key: Type.String(),
  value: Type.Unknown(),
  source: Type.Union([Type.Literal('config'), Type.Literal('dashboard'), Type.Literal('default')]),
  locked: Type.Boolean({ description: 'True when config.yaml defines the key; the dashboard cannot change it.' }),
  default: Type.Unknown(),
  description: Type.String(),
});

export const SettingsUpdateSchema = Type.Object({
  values: Type.Record(Type.String(), Type.Unknown(), {
    description: 'Setting key → new value, or null to reset it to its default.',
  }),
}, { additionalProperties: false });

// ------------------------------------------------------------------ auth & setup

export const SetupStatusSchema = Type.Object({ adminExists: Type.Boolean(), setupPasswordConfigured: Type.Boolean() });
export const UsernameSchema = Type.Object({ username: Type.String() });
export const SessionSchema = Type.Object({
  username: Nullable(Type.String()),
  setupPasswordStillSet: Type.Boolean({ description: 'True while the setup password is still in the environment.' }),
  csrfHeader: Type.String(),
});

// ------------------------------------------------------------------ submissions & captcha

export const AltchaChallengeSchema = Type.Object({}, {
  additionalProperties: true,
  description: 'ALTCHA proof-of-work challenge, passed unchanged to the bundled widget.',
});

export const SubmissionFormSchema = Type.Object({
  event: Type.String({ description: 'JSON-encoded event (see EventInput).' }),
  agtUsername: Type.String({ description: "Submitter's AGT username, shown only to the admin." }),
  altcha: Type.String({ description: 'Base64 ALTCHA solution payload from the widget.' }),
  cover: Type.Optional(Type.String({ format: 'binary', description: 'Cover image: PNG, JPEG, WebP or GIF.' })),
});

export const SubmissionResultSchema = Type.Object({ id: Uuid, status: Type.Literal('pending') });

// ------------------------------------------------------------------ Migrate from Amplify

export const MigrationFormSchema = Type.Object({
  zip: Type.String({ format: 'binary', description: 'Migration ZIP with csv/, markdown/ and covers/ at its root.' }),
  mode: Type.Optional(Type.Union([Type.Literal('preview'), Type.Literal('commit')], { default: 'preview' })),
  onExisting: Type.Optional(Type.Union([Type.Literal('skip'), Type.Literal('overwrite')], { default: 'skip' })),
});

export const MigrationReportSchema = Type.Object({
  dryRun: Type.Boolean(),
  onExisting: Type.Union([Type.Literal('skip'), Type.Literal('overwrite')]),
  events: Type.Object({
    toCreate: Type.Integer(),
    toOverwrite: Type.Integer(),
    alreadyMigrated: Type.Integer(),
    skipped: Type.Integer(),
    items: Type.Array(Type.Object({
      row: Type.Integer(),
      legacyId: Type.String(),
      name: Type.String(),
      action: Type.Union([Type.Literal('create'), Type.Literal('overwrite'), Type.Literal('already-migrated')]),
      description: Type.Boolean(),
      cover: Type.Boolean(),
    })),
  }),
  holidays: Type.Object({ toCreate: Type.Integer(), alreadyPresent: Type.Integer(), skipped: Type.Integer() }),
  descriptionsStored: Type.Integer(),
  coversStored: Type.Integer(),
  errors: Type.Array(Type.Object({ file: Type.String(), row: Type.Integer(), messages: Type.Array(Type.String()) })),
  warnings: Type.Array(Type.String()),
  missingFiles: Type.Array(Type.String()),
  unreferencedFiles: Type.Array(Type.String()),
  ignoredEntries: Type.Array(Type.String()),
  csvFiles: Type.Object({ events: Type.String(), holidays: Type.String() }),
});

// ------------------------------------------------------------------ backup & restore

export const RestoreFormSchema = Type.Object({
  backup: Type.String({ format: 'binary', description: 'Backup ZIP downloaded from GET /api/admin/backup.' }),
  action: Type.Optional(Type.Union([Type.Literal('preview'), Type.Literal('restore')], { default: 'preview' })),
});

export const RestoreReportSchema = Type.Object({
  createdAt: Timestamp,
  appVersion: Type.String(),
  schemaVersion: Type.Integer(),
  upgradedFromSchemaVersion: Nullable(Type.Integer()),
  counts: Type.Object({ events: Type.Integer(), holidays: Type.Integer(), changelog: Type.Integer(), images: Type.Integer() }),
  adminUsername: Nullable(Type.String()),
  ignoredSettings: Type.Array(Type.Object({ key: Type.String(), reason: Type.String() })),
  droppedFiles: Type.Array(Type.String()),
  config: Type.Object({
    included: Type.Boolean(),
    applied: Type.Literal(false, { description: 'config.yaml is never restored.' }),
    text: Nullable(Type.String()),
    identical: Type.Boolean(),
    diff: Type.Array(Type.String()),
  }),
  preRestoreBackup: Nullable(Type.String()),
});
