import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { ConfigError, loadConfig } from './config';
import type { AppContext } from './context';
import { OperationLock } from './dataWrite';
import { openDatabase } from './db';
import type { Migration } from './db';
import { LogStore, createLogger } from './logs';
import { getAdmin } from './repository';
import { logStartup, readSetupPassword } from './startup';

function appVersion(root: string): string {
  try {
    return (JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }).version;
  } catch {
    return '0.0.0';
  }
}

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, '..');
  const configPath = path.resolve(process.env.AGT_CONFIG_FILE ?? 'config.yaml');
  let config;
  try {
    config = loadConfig(configPath);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`Refusing to start: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  const logMigrations: Migration[] = [];
  const logs = LogStore.open(config.logDatabaseFile, (migration) => logMigrations.push(migration));
  const migrations: Migration[] = [];
  const db = openDatabase(config.databaseFile, { onMigration: (migration) => migrations.push(migration) });
  const setupPassword = readSetupPassword(process.env.AGT_SETUP_PASSWORD, getAdmin(db) !== null);
  if (setupPassword.error) {
    console.error(`Refusing to start: ${setupPassword.error}`);
    process.exit(1);
  }
  const context: AppContext = {
    config,
    db,
    logs,
    setupPassword: setupPassword.value,
    operation: new OperationLock(),
    version: appVersion(root),
  };
  // stdout follows server.logLevel; the server log gets info and above (LOG-5).
  const logger = createLogger(logs, config.logLevel);
  const app = await buildApp(context, {
    logger,
    staticDir: path.resolve(process.env.AGT_STATIC_DIR ?? path.join(root, 'dist')),
  });

  const shutdown = async (signal: string) => {
    app.log.info({ source: 'shutdown', signal }, `Shutting down (${signal}).`);
    await app.close();
    context.db.close();
    context.logs.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  const address = await app.listen({ host: config.host, port: config.port });
  logStartup(app.log, context, { migrations, logMigrations, address });
}

void main();
