import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { ConfigError, loadConfig } from './config';
import type { AppContext } from './context';
import { openDatabase } from './db';
import { getAdmin } from './repository';

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

  const db = openDatabase(config.databaseFile);
  const context: AppContext = {
    config,
    db,
    setupPassword: process.env.AGT_SETUP_PASSWORD?.trim() || null,
    version: appVersion(root),
  };
  const app = await buildApp(context, {
    logger: { level: config.logLevel },
    staticDir: path.resolve(process.env.AGT_STATIC_DIR ?? path.join(root, 'dist')),
  });

  if (config.rawText === null) app.log.warn(`No configuration file at ${configPath}; using defaults.`);
  if (getAdmin(context.db)) {
    if (context.setupPassword) {
      app.log.warn('AGT_SETUP_PASSWORD is still set but is ignored because the admin account exists. Remove it from .env and restart.');
    }
  } else if (context.setupPassword) {
    app.log.info('No admin account exists yet. Open /admin and use AGT_SETUP_PASSWORD to create it.');
  } else {
    app.log.warn('No admin account exists and AGT_SETUP_PASSWORD is not set. Set it in .env and restart to create the admin account.');
  }

  const shutdown = async () => {
    await app.close();
    context.db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  await app.listen({ host: config.host, port: config.port });
}

void main();
