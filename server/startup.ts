/**
 * Server log entries written at startup (AGT web app spec LOG-8, AUTH-6). Kept
 * out of index.ts so tests can check them.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from './context';
import { SCHEMA_VERSION } from './db';
import type { Migration } from './db';
import { LOG_SCHEMA_VERSION } from './logs';
import { getAdmin } from './repository';

export interface StartupInfo {
  /** Migrations applied to the main database while opening it. */
  migrations: Migration[];
  /** Migrations applied to the log store while opening it. */
  logMigrations: Migration[];
  /** The address the server listens on. */
  address: string;
}

/** The longest setup password, in Unicode code points as read from the environment (AUTH-5). */
export const MAX_SETUP_PASSWORD_LENGTH = 1024;

/**
 * Reads `AGT_SETUP_PASSWORD`. An empty value means "not set". While no admin exists, a value longer than 1024
 * characters stops the server (AUTH-5, SRV-8): it could never be typed into a setup request. Once the admin exists
 * the value is only warned about (AUTH-6).
 */
export function readSetupPassword(raw: string | undefined, adminExists: boolean): { value: string | null; error: string | null } {
  const value = raw?.trim() || null;
  if (value !== null && !adminExists && [...raw!].length > MAX_SETUP_PASSWORD_LENGTH) {
    return { value, error: `AGT_SETUP_PASSWORD is longer than ${MAX_SETUP_PASSWORD_LENGTH} characters. Set a shorter value in .env and restart.` };
  }
  return { value, error: null };
}

export function logStartup(log: FastifyBaseLogger, context: AppContext, info: StartupInfo): void {
  for (const migration of info.logMigrations) {
    log.info({ source: 'migrations', store: 'logs', version: migration.version, name: migration.name }, `Applied log store migration ${migration.name}.`);
  }
  for (const migration of info.migrations) {
    log.info({ source: 'migrations', store: 'database', version: migration.version, name: migration.name }, `Applied database migration ${migration.name}.`);
  }

  const { config } = context;
  const configFile = config.rawText === null ? null : config.filePath;
  if (configFile === null) log.warn({ source: 'config', configFile: config.filePath }, `No configuration file at ${config.filePath}; using defaults.`);

  if (config.file.altcha?.hmacKey !== undefined) {
    log.warn({ source: 'config', key: 'altcha.hmacKey' },
      'altcha.hmacKey in config.yaml is deprecated and ignored: the captcha key is generated and stored in the database. Remove it from config.yaml.');
  }

  if (getAdmin(context.db)) {
    if (context.setupPassword) {
      log.warn({ source: 'config' }, 'AGT_SETUP_PASSWORD is still set but is ignored because the admin account exists. Remove it from .env and restart.');
    }
  } else if (context.setupPassword) {
    log.info({ source: 'config' }, 'No admin account exists yet. Open /admin and use AGT_SETUP_PASSWORD to create it.');
  } else {
    log.warn({ source: 'config' }, 'No admin account exists and AGT_SETUP_PASSWORD is not set. Set it in .env and restart to create the admin account.');
  }

  log.info({
    source: 'startup',
    version: context.version,
    schemaVersion: SCHEMA_VERSION,
    logSchemaVersion: LOG_SCHEMA_VERSION,
    address: info.address,
    configFile,
    defaults: configFile === null,
  }, `AGT Event Calendar ${context.version} started on ${info.address} (${configFile === null ? 'default configuration' : `configuration from ${configFile}`}).`);
}
