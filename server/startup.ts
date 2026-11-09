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
