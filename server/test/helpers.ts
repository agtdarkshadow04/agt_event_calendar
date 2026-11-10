import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { solveChallenge } from 'altcha-lib';
import type { Challenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/sha';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { parseConfigText, resolveConfig } from '../config';
import type { AppContext } from '../context';
import { openDatabase } from '../db';
import { LogStore } from '../logs';
import { writeZip } from '../zip';

export const SETUP_PASSWORD = 'temporary-setup-password';
export const ADMIN = { username: 'admin', password: 'correct horse battery staple' };
export const FIXTURES = path.resolve('server/test/fixtures');
export const CSRF = { 'x-agt-request': '1' };

export interface TestServer {
  app: FastifyInstance;
  context: AppContext;
  dir: string;
  close(): Promise<void>;
}

export async function createTestServer(
  options: { config?: string; setupPassword?: string | null; staticDir?: string } = {},
): Promise<TestServer> {
  const dir = mkdtempSync(path.join(tmpdir(), 'agt-test-'));
  const configText = options.config ?? '';
  const file = parseConfigText(`altcha:\n  cost: 1000\n${configText}`);
  const config = resolveConfig(file, configText || null, path.join(dir, 'config.yaml'), dir);
  const context: AppContext = {
    config,
    db: openDatabase(config.databaseFile),
    logs: LogStore.open(config.logDatabaseFile),
    setupPassword: options.setupPassword === undefined ? SETUP_PASSWORD : options.setupPassword,
    version: 'test',
  };
  const app = await buildApp(context, { staticDir: options.staticDir });
  return {
    app,
    context,
    dir,
    close: async () => {
      await app.close();
      context.db.close();
      context.logs.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function cookieFrom(response: { headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : String(header ?? '');
  return value.split(';')[0];
}

export async function setupAdmin(server: TestServer): Promise<string> {
  const response = await server.app.inject({
    method: 'POST',
    url: '/api/setup',
    headers: CSRF,
    payload: { setupPassword: SETUP_PASSWORD, ...ADMIN },
  });
  if (response.statusCode !== 201) throw new Error(`Setup failed: ${response.body}`);
  return cookieFrom(response);
}

export async function solveAltcha(server: TestServer): Promise<string> {
  const response = await server.app.inject({ method: 'GET', url: '/api/altcha/challenge' });
  if (response.statusCode !== 200) throw new Error(`Challenge failed: ${response.body}`);
  const challenge = response.json() as Challenge;
  const solution = await solveChallenge({ challenge, deriveKey });
  return Buffer.from(JSON.stringify({ challenge, solution })).toString('base64');
}

export interface MultipartFile { name: string; fileName: string; contentType: string; data: Buffer }

export function multipart(fields: Record<string, string>, files: MultipartFile[] = []) {
  const boundary = `----agt${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  for (const file of files) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.fileName}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
    ));
    chunks.push(file.data, Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

/** Lists a fixture directory's files as ZIP entries, optionally under a prefix. */
export function fixtureFiles(directory: string, prefix = ''): { name: string; data: Buffer }[] {
  const files: { name: string; data: Buffer }[] = [];
  const walk = (current: string) => {
    for (const name of readdirSync(current).sort()) {
      const full = path.join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.push({ name: prefix + path.relative(directory, full).split(path.sep).join('/'), data: readFileSync(full) });
    }
  };
  walk(directory);
  return files;
}

export async function makeZip(dir: string, name: string, files: { name: string; data?: Buffer | string }[]): Promise<Buffer> {
  const zipPath = path.join(dir, name);
  await writeZip(zipPath, files);
  return readFileSync(zipPath);
}

export const JPEG = readFileSync(path.join(FIXTURES, 'amplify-migration/covers/0001.jpg'));
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export const validEvent = {
  name: 'Community Meetup',
  start: '2030-01-01T18:00:00Z',
  end: '2030-01-01T20:00:00Z',
  type: 'Meetup',
  galaxy: 'Euclid',
  region: 'Region',
  system: 'System',
  portalCode: '0123ABCD4567',
  links: ['https://example.com'],
};
