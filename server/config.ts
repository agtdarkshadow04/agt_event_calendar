import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Type } from '@sinclair/typebox';
import type { Static, TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { parseDocument } from 'yaml';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const HttpUrl = Type.String({ pattern: '^https?://', maxLength: 2000 });
const PositiveInt = (maximum: number) => Type.Integer({ minimum: 1, maximum });
/** Log retention limits (AGT web app spec LOG-16). The audit minimum of 30 days is deliberate. */
const LOG_LIMITS = {
  serverRetentionDays: Type.Integer({ minimum: 1, maximum: 3650 }),
  serverMaxEntries: Type.Integer({ minimum: 1000, maximum: 10_000_000 }),
  auditRetentionDays: Type.Integer({ minimum: 30, maximum: 3650 }),
  auditMaxEntries: Type.Integer({ minimum: 10_000, maximum: 10_000_000 }),
};
const RateLimit = Type.Object({
  max: Type.Optional(PositiveInt(10_000)),
  windowMinutes: Type.Optional(PositiveInt(1440)),
}, { additionalProperties: false });

/**
 * Schema of `config.yaml`. Every key is optional; unknown keys are rejected.
 * Keys listed in `EDITABLE_SETTINGS` can alternatively be set from the admin
 * dashboard, but only while the config file does not define them.
 */
export const ConfigFileSchema = Type.Object({
  server: Type.Optional(Type.Object({
    host: Type.Optional(Type.String({ minLength: 1 })),
    port: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
    trustProxy: Type.Optional(Type.Union([Type.Boolean(), Type.String({ minLength: 1 }), Type.Array(Type.String({ minLength: 1 }))])),
    logLevel: Type.Optional(Type.Union(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].map((level) => Type.Literal(level)))),
  }, { additionalProperties: false })),
  storage: Type.Optional(Type.Object({
    dataDir: Type.Optional(Type.String({ minLength: 1 })),
    databaseFile: Type.Optional(Type.String({ minLength: 1 })),
    uploadsDir: Type.Optional(Type.String({ minLength: 1 })),
    backupsDir: Type.Optional(Type.String({ minLength: 1 })),
    logDatabaseFile: Type.Optional(Type.String({ minLength: 1 })),
  }, { additionalProperties: false })),
  session: Type.Optional(Type.Object({
    ttlHours: Type.Optional(PositiveInt(24 * 90)),
    secureCookie: Type.Optional(Type.Union([Type.Boolean(), Type.Literal('auto')])),
  }, { additionalProperties: false })),
  rateLimits: Type.Optional(Type.Object({
    login: Type.Optional(RateLimit),
    setup: Type.Optional(RateLimit),
    adminUploads: Type.Optional(RateLimit),
  }, { additionalProperties: false })),
  altcha: Type.Optional(Type.Object({
    hmacKey: Type.Optional(Type.String({ minLength: 32 })),
    cost: Type.Optional(Type.Integer({ minimum: 1000, maximum: 10_000_000 })),
    challengeTtlSeconds: Type.Optional(Type.Integer({ minimum: 30, maximum: 3600 })),
  }, { additionalProperties: false })),
  site: Type.Optional(Type.Object({
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    supportUrl: Type.Optional(HttpUrl),
    glyphToolUrl: Type.Optional(HttpUrl),
  }, { additionalProperties: false })),
  submissions: Type.Optional(Type.Object({
    enabled: Type.Optional(Type.Boolean()),
    rateLimit: Type.Optional(RateLimit),
  }, { additionalProperties: false })),
  uploads: Type.Optional(Type.Object({
    maxImageBytes: Type.Optional(Type.Integer({ minimum: 1024, maximum: MAX_IMAGE_BYTES })),
  }, { additionalProperties: false })),
  migration: Type.Optional(Type.Object({
    maxZipBytes: Type.Optional(Type.Integer({ minimum: 1024, maximum: 2 * 1024 ** 3 })),
    maxUncompressedBytes: Type.Optional(Type.Integer({ minimum: 1024, maximum: 8 * 1024 ** 3 })),
    maxEntries: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
  }, { additionalProperties: false })),
  logs: Type.Optional(Type.Object({
    serverRetentionDays: Type.Optional(LOG_LIMITS.serverRetentionDays),
    serverMaxEntries: Type.Optional(LOG_LIMITS.serverMaxEntries),
    auditRetentionDays: Type.Optional(LOG_LIMITS.auditRetentionDays),
    auditMaxEntries: Type.Optional(LOG_LIMITS.auditMaxEntries),
  }, { additionalProperties: false })),
}, { additionalProperties: false });

export type ConfigFile = Static<typeof ConfigFileSchema>;

interface SettingDefinition {
  schema: TSchema;
  default: unknown;
  description: string;
}

/** Settings that may be edited in the dashboard unless `config.yaml` defines them. */
export const EDITABLE_SETTINGS = {
  'site.title': { schema: Type.String({ minLength: 1, maxLength: 100 }), default: 'AGT Event Calendar', description: 'Site title shown in the browser tab.' },
  'site.supportUrl': { schema: HttpUrl, default: 'https://www.nms-agt.com/support', description: 'Bug report / support link in the header.' },
  'site.glyphToolUrl': { schema: HttpUrl, default: 'https://glyph.nms-agt.com/', description: 'Base URL of the portal glyph tool.' },
  'submissions.enabled': { schema: Type.Boolean(), default: true, description: 'Accept public event submissions.' },
  'submissions.rateLimit.max': { schema: PositiveInt(10_000), default: 5, description: 'Submissions allowed per client per window.' },
  'submissions.rateLimit.windowMinutes': { schema: PositiveInt(1440), default: 60, description: 'Submission rate-limit window in minutes.' },
  'uploads.maxImageBytes': { schema: Type.Integer({ minimum: 1024, maximum: MAX_IMAGE_BYTES }), default: MAX_IMAGE_BYTES, description: 'Maximum image upload size in bytes (at most 10 MB).' },
  'migration.maxZipBytes': { schema: Type.Integer({ minimum: 1024, maximum: 2 * 1024 ** 3 }), default: 200 * 1024 ** 2, description: 'Maximum size of a migration or backup ZIP upload in bytes.' },
  'migration.maxUncompressedBytes': { schema: Type.Integer({ minimum: 1024, maximum: 8 * 1024 ** 3 }), default: 1024 ** 3, description: 'Maximum total uncompressed size of a ZIP in bytes.' },
  'migration.maxEntries': { schema: Type.Integer({ minimum: 1, maximum: 100_000 }), default: 10_000, description: 'Maximum number of entries in a ZIP.' },
  'logs.serverRetentionDays': { schema: LOG_LIMITS.serverRetentionDays, default: 30, description: 'Days server log entries are kept (1–3650).' },
  'logs.serverMaxEntries': { schema: LOG_LIMITS.serverMaxEntries, default: 100_000, description: 'Maximum number of server log entries; the oldest are deleted first.' },
  'logs.auditRetentionDays': { schema: LOG_LIMITS.auditRetentionDays, default: 365, description: 'Days audit log entries are kept (at least 30).' },
  'logs.auditMaxEntries': { schema: LOG_LIMITS.auditMaxEntries, default: 1_000_000, description: 'Maximum number of audit log entries; failed and denied attempts are deleted first.' },
} satisfies Record<string, SettingDefinition>;

export type SettingKey = keyof typeof EDITABLE_SETTINGS;
export const SETTING_KEYS = Object.keys(EDITABLE_SETTINGS) as SettingKey[];

export interface ResolvedConfig {
  /** The parsed file, used to know which keys the operator defined. */
  file: ConfigFile;
  /** Raw text of the config file exactly as mounted, or null when absent. */
  rawText: string | null;
  filePath: string;
  host: string;
  port: number;
  trustProxy: boolean | string | string[];
  logLevel: string;
  dataDir: string;
  databaseFile: string;
  uploadsDir: string;
  backupsDir: string;
  /** The log store (server log and audit log), never part of a backup. */
  logDatabaseFile: string;
  sessionTtlHours: number;
  secureCookie: boolean | 'auto';
  rateLimits: Record<'login' | 'setup' | 'adminUploads', { max: number; windowMinutes: number }>;
  altcha: { hmacKey: string | null; cost: number; challengeTtlSeconds: number };
}

export class ConfigError extends Error {}

/** Reads a dotted key such as `submissions.enabled` from the parsed file. */
export function getFileValue(file: ConfigFile, key: string): unknown {
  let value: unknown = file;
  for (const part of key.split('.')) {
    if (value === null || typeof value !== 'object' || !(part in value)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

export function parseConfigText(text: string): ConfigFile {
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new ConfigError(`config.yaml is not valid YAML: ${document.errors[0].message}`);
  }
  const data = document.toJS() ?? {};
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new ConfigError('config.yaml must contain a mapping of keys at the top level.');
  }
  const errors = [...Value.Errors(ConfigFileSchema, data)];
  if (errors.length > 0) {
    const messages = errors.slice(0, 5).map((error) => {
      const key = error.path.replace(/^\//, '').replaceAll('/', '.') || '(root)';
      return `${key}: ${error.message}`;
    });
    throw new ConfigError(`Invalid config.yaml: ${messages.join('; ')}`);
  }
  return data as ConfigFile;
}

export function resolveConfig(file: ConfigFile, rawText: string | null, filePath: string, baseDir = process.cwd()): ResolvedConfig {
  const dataDir = path.resolve(baseDir, file.storage?.dataDir ?? 'data');
  const inData = (value: string | undefined, fallback: string) => path.resolve(dataDir, value ?? fallback);
  const rate = (value: { max?: number; windowMinutes?: number } | undefined, max: number, windowMinutes: number) => ({
    max: value?.max ?? max,
    windowMinutes: value?.windowMinutes ?? windowMinutes,
  });
  return {
    file,
    rawText,
    filePath,
    host: file.server?.host ?? '0.0.0.0',
    port: file.server?.port ?? 8080,
    trustProxy: file.server?.trustProxy ?? false,
    logLevel: file.server?.logLevel ?? 'info',
    dataDir,
    databaseFile: inData(file.storage?.databaseFile, 'agt-calendar.sqlite'),
    uploadsDir: inData(file.storage?.uploadsDir, 'uploads'),
    backupsDir: inData(file.storage?.backupsDir, 'backups'),
    logDatabaseFile: inData(file.storage?.logDatabaseFile, 'logs.sqlite'),
    sessionTtlHours: file.session?.ttlHours ?? 12,
    secureCookie: file.session?.secureCookie ?? 'auto',
    rateLimits: {
      login: rate(file.rateLimits?.login, 10, 15),
      setup: rate(file.rateLimits?.setup, 10, 15),
      adminUploads: rate(file.rateLimits?.adminUploads, 120, 15),
    },
    altcha: {
      hmacKey: file.altcha?.hmacKey ?? null,
      cost: file.altcha?.cost ?? 5_000,
      challengeTtlSeconds: file.altcha?.challengeTtlSeconds ?? 600,
    },
  };
}

/**
 * Loads and validates the config file. A missing file means "all defaults".
 * Relative storage paths resolve against the working directory.
 */
export function loadConfig(filePath: string): ResolvedConfig {
  let rawText: string | null = null;
  try {
    rawText = readFileSync(filePath, 'utf8');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new ConfigError(`Unable to read ${filePath}: ${(error as Error).message}`);
    }
  }
  const file = rawText === null ? {} : parseConfigText(rawText);
  return resolveConfig(file, rawText, filePath);
}
