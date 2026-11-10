/**
 * Backup export and restore. A backup is one ZIP with a consistent SQLite
 * snapshot, the uploads, the current config.yaml and a checksummed manifest.
 * `.env` is never included. Restore never writes config.yaml.
 */
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { FastifyBaseLogger } from 'fastify';
import path from 'node:path';
import { SETTING_KEYS } from './config';
import type { AppContext } from './context';
import { isDefinedInConfig } from './context';
import { ensureAltchaKey } from './altcha';
import { missingTables, openDatabase, runMigrations, schemaVersion, SCHEMA_VERSION } from './db';
import type { Db } from './db';
import { asOperationOwner } from './dataWrite';
import type { RecoverySession } from './dataWrite';
import { HttpError } from './http';
import { STORED_IMAGE_NAME, validateImage } from './images';
import { parseStoredHash } from './passwords';
import { settingOrDefault } from './context';
import { openSafeZip, writeZip, ZipRejectedError } from './zip';
import Database from 'better-sqlite3';

export const BACKUP_FORMAT = 'agt-event-calendar-backup';
export const BACKUP_FORMAT_VERSION = 1;

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  appVersion: string;
  schemaVersion: number;
  createdAt: string;
  files: { path: string; size: number; sha256: string }[];
}

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

const MANIFEST_FIELDS = ['format', 'formatVersion', 'appVersion', 'schemaVersion', 'createdAt', 'files'];
const FILE_FIELDS = ['path', 'size', 'sha256'];
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

/** A relative POSIX path: `/` separators, no leading `/`, no empty, `.` or `..` segments, no backslashes (BAK-2). */
export function isSafeArchivePath(value: string): boolean {
  if (value === '' || value.startsWith('/') || value.includes('\\') || value.includes('\0')) return false;
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasExactly = (value: Record<string, unknown>, fields: string[]) =>
  Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field));

/**
 * Checks `manifest.json` against BAK-2 and BAK-7: exactly the six fields with their types, a `formatVersion` this
 * app can read, and one `{ path, size, sha256 }` per file with a safe, unique path.
 */
export function parseManifest(value: unknown): BackupManifest {
  if (!isObject(value) || value.format !== BACKUP_FORMAT) {
    throw new RestoreRejectedError('manifest.json is not an AGT Event Calendar backup manifest.');
  }
  if (!Number.isInteger(value.formatVersion) || (value.formatVersion as number) < 1) {
    throw new RestoreRejectedError('manifest.json has an invalid formatVersion.');
  }
  if ((value.formatVersion as number) > BACKUP_FORMAT_VERSION) {
    throw new RestoreRejectedError(`The backup format version ${String(value.formatVersion)} is newer than this application supports (${BACKUP_FORMAT_VERSION}).`);
  }
  if (!hasExactly(value, MANIFEST_FIELDS)) {
    throw new RestoreRejectedError(`manifest.json must have exactly the fields ${MANIFEST_FIELDS.join(', ')}.`);
  }
  if (typeof value.appVersion !== 'string' || value.appVersion === '') throw new RestoreRejectedError('manifest.json has an invalid appVersion.');
  if (!Number.isInteger(value.schemaVersion) || (value.schemaVersion as number) < 1) {
    throw new RestoreRejectedError('manifest.json has an invalid schemaVersion.');
  }
  if (typeof value.createdAt !== 'string' || !ISO_UTC.test(value.createdAt) || Number.isNaN(Date.parse(value.createdAt))) {
    throw new RestoreRejectedError('manifest.json has an invalid createdAt.');
  }
  if (!Array.isArray(value.files)) throw new RestoreRejectedError('manifest.json has no files list.');
  const paths = new Set<string>();
  for (const file of value.files as unknown[]) {
    if (!isObject(file) || !hasExactly(file, FILE_FIELDS) || typeof file.path !== 'string'
      || !Number.isSafeInteger(file.size) || (file.size as number) < 0
      || typeof file.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(file.sha256)) {
      throw new RestoreRejectedError('manifest.json has an invalid files entry.');
    }
    if (!isSafeArchivePath(file.path) || file.path === 'manifest.json') {
      throw new RestoreRejectedError(`manifest.json lists an unsafe path: ${file.path}`);
    }
    if (paths.has(file.path)) throw new RestoreRejectedError(`manifest.json lists ${file.path} twice.`);
    paths.add(file.path);
  }
  return value as unknown as BackupManifest;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function tempDir(context: AppContext, prefix: string): string {
  mkdirSync(context.config.backupsDir, { recursive: true });
  const dir = path.join(context.config.backupsDir, `.${prefix}-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function uploadFiles(uploadsDir: string): string[] {
  if (!existsSync(uploadsDir)) return [];
  return readdirSync(uploadsDir).filter((name) => STORED_IMAGE_NAME.test(name)).sort();
}

/**
 * Creates a backup ZIP and returns its path. The caller deletes it when done
 * unless `keep` is set (automatic pre-restore backups are kept).
 */
export async function createBackup(context: AppContext, options: { keep?: boolean; prefix?: string } = {}): Promise<{ path: string; fileName: string }> {
  const workDir = tempDir(context, 'backup');
  try {
    const snapshot = path.join(workDir, 'database.sqlite');
    await context.db.backup(snapshot);
    const snapshotDb = new Database(snapshot);
    try {
      snapshotDb.prepare('DELETE FROM sessions').run();
      snapshotDb.pragma('journal_mode = DELETE');
      snapshotDb.exec('VACUUM');
    } finally {
      snapshotDb.close();
    }

    const files: { name: string; data?: Buffer; path?: string }[] = [];
    const manifestFiles: BackupManifest['files'] = [];
    const add = (name: string, data: Buffer) => {
      files.push({ name, data });
      manifestFiles.push({ path: name, size: data.length, sha256: sha256(data) });
    };
    add('database.sqlite', readFileSync(snapshot));
    for (const name of uploadFiles(context.config.uploadsDir)) {
      add(`uploads/${name}`, readFileSync(path.join(context.config.uploadsDir, name)));
    }
    if (context.config.rawText !== null) add('config.yaml', Buffer.from(context.config.rawText, 'utf8'));

    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      appVersion: context.version,
      schemaVersion: SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      files: manifestFiles,
    };
    files.unshift({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) });

    const fileName = `${options.prefix ?? 'agt-event-calendar-backup'}-${timestamp()}.zip`;
    const outputPath = path.join(options.keep ? context.config.backupsDir : workDir, fileName);
    await writeZip(outputPath, files);
    if (options.keep) rmSync(workDir, { recursive: true, force: true });
    return { path: outputPath, fileName };
  } catch (error) {
    rmSync(workDir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * The backup download: the whole snapshot (database and uploads) is taken in the `backup` state, after the data
 * writes in progress have drained, so no write lands between the two (BAK-8, BAK-9).
 */
export function downloadBackup(context: AppContext): Promise<{ path: string; fileName: string }> {
  return context.operation.run('backup', () => createBackup(context));
}

/** Removes the temporary directory a non-kept backup was written to. */
export function discardBackup(backupPath: string): void {
  const dir = path.dirname(backupPath);
  if (path.basename(dir).startsWith('.backup-')) rmSync(dir, { recursive: true, force: true });
}

export interface RestoreReport {
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
  upgradedFromSchemaVersion: number | null;
  counts: { events: number; holidays: number; changelog: number; images: number };
  adminUsername: string | null;
  ignoredSettings: { key: string; reason: string }[];
  droppedFiles: string[];
  config: { included: boolean; applied: false; text: string | null; identical: boolean; diff: string[] };
  preRestoreBackup: string | null;
  /** Restore only: paths set aside that could not be deleted (BAK-4 step 6.2). Empty in a preview. */
  warnings: string[];
}

export class RestoreRejectedError extends ZipRejectedError {}

/** Line diff (LCS) used to show how a backed-up config.yaml differs from the mounted one. */
export function lineDiff(before: string, after: string): string[] {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  if (a.length * b.length > 4_000_000) return ['(files too large to compare)'];
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { out.push(`  ${a[i]}`); i += 1; j += 1; }
    else if (j < b.length && (i >= a.length || lcs[i][j + 1] >= lcs[i + 1][j])) { out.push(`+ ${b[j]}`); j += 1; }
    else { out.push(`- ${a[i]}`); i += 1; }
  }
  return out;
}

interface StagedRestore {
  dir: string;
  databaseFile: string;
  uploadsDir: string;
  report: RestoreReport;
}

/** Validates a backup archive and stages it in a temporary directory. Nothing live is touched. */
async function stageRestore(context: AppContext, zipPath: string): Promise<StagedRestore> {
  const zip = await openSafeZip(zipPath, {
    maxEntries: settingOrDefault(context, 'migration.maxEntries'),
    maxUncompressedBytes: settingOrDefault(context, 'migration.maxUncompressedBytes'),
  });
  const dir = tempDir(context, 'restore');
  try {
    const byName = new Map(zip.entries.filter((entry) => !entry.isDirectory).map((entry) => [entry.name, entry]));
    for (const entry of zip.entries) {
      if (!isSafeArchivePath(entry.isDirectory ? entry.name.replace(/\/$/, '') : entry.name)) {
        throw new RestoreRejectedError(`The backup contains an unsafe path: ${entry.name}`);
      }
      const allowed = entry.isDirectory
        ? entry.name === 'uploads/'
        : ['manifest.json', 'database.sqlite', 'config.yaml'].includes(entry.name) ||
          (entry.name.startsWith('uploads/') && STORED_IMAGE_NAME.test(entry.name.slice('uploads/'.length)));
      if (!allowed) throw new RestoreRejectedError(`The backup contains an unexpected path: ${entry.name}`);
    }
    const manifestEntry = byName.get('manifest.json');
    if (!manifestEntry) throw new RestoreRejectedError('The backup has no manifest.json.');
    let parsed: unknown;
    try {
      parsed = JSON.parse((await zip.read(manifestEntry, 10 * 1024 * 1024)).toString('utf8'));
    } catch {
      throw new RestoreRejectedError('manifest.json is not valid JSON.');
    }
    const manifest = parseManifest(parsed);
    const listed = new Map(manifest.files.map((file) => [file.path, file]));
    for (const name of byName.keys()) {
      if (name !== 'manifest.json' && !listed.has(name)) throw new RestoreRejectedError(`${name} is not listed in the manifest.`);
    }
    for (const name of listed.keys()) {
      if (!byName.has(name)) throw new RestoreRejectedError(`${name} is listed in the manifest but missing from the archive.`);
    }
    if (!listed.has('database.sqlite')) throw new RestoreRejectedError('The backup has no database.sqlite.');

    const databaseFile = path.join(dir, 'database.sqlite');
    const uploadsDir = path.join(dir, 'uploads');
    mkdirSync(uploadsDir);
    const droppedFiles: string[] = [];
    const images = new Map<string, Buffer>();
    let configText: string | null = null;
    for (const [name, file] of listed) {
      const data = await zip.read(byName.get(name)!, name === 'database.sqlite' ? Number.POSITIVE_INFINITY : 10 * 1024 * 1024 + 1);
      if (data.length !== file.size || sha256(data) !== file.sha256) {
        throw new RestoreRejectedError(`Checksum mismatch for ${name}: the backup is corrupted or was modified.`);
      }
      if (name === 'database.sqlite') writeFileSync(databaseFile, data);
      else if (name === 'config.yaml') configText = data.toString('utf8');
      else images.set(name.slice('uploads/'.length), data);
    }

    let db: Db;
    try {
      db = new Database(databaseFile, { fileMustExist: true });
    } catch (error) {
      throw new RestoreRejectedError(`database.sqlite cannot be opened: ${(error as Error).message}`);
    }
    let report: RestoreReport;
    try {
      let integrity: string;
      try {
        integrity = db.pragma('integrity_check', { simple: true }) as string;
      } catch (error) {
        throw new RestoreRejectedError(`database.sqlite is not a valid SQLite database: ${(error as Error).message}`);
      }
      if (integrity !== 'ok') throw new RestoreRejectedError(`database.sqlite failed the integrity check: ${integrity}`);
      const version = schemaVersion(db);
      if (version > SCHEMA_VERSION) {
        throw new RestoreRejectedError(`The backup's database schema version ${version} is newer than this application supports (${SCHEMA_VERSION}).`);
      }
      if (version < 1) throw new RestoreRejectedError('database.sqlite does not have the expected schema.');
      db.pragma('foreign_keys = ON');
      runMigrations(db);
      const missing = missingTables(db);
      if (missing.length > 0) throw new RestoreRejectedError(`database.sqlite is missing tables: ${missing.join(', ')}`);
      const foreignKeyProblems = db.pragma('foreign_key_check') as unknown[];
      if (foreignKeyProblems.length > 0) throw new RestoreRejectedError('database.sqlite has broken references between tables.');

      const imageRows = db.prepare('SELECT id, file_name, mime_type FROM images').all() as { id: string; file_name: string; mime_type: string }[];
      const referenced = new Set<string>();
      for (const row of imageRows) {
        const data = images.get(row.file_name);
        if (!data) throw new RestoreRejectedError(`Image ${row.file_name} is referenced by the database but missing from the backup.`);
        let detected: string;
        try {
          detected = validateImage(data, { fileName: row.file_name });
        } catch (error) {
          throw new RestoreRejectedError(`uploads/${row.file_name} was rejected: ${(error as Error).message}`);
        }
        if (detected !== row.mime_type) throw new RestoreRejectedError(`uploads/${row.file_name} does not match its recorded type.`);
        writeFileSync(path.join(uploadsDir, row.file_name), data);
        referenced.add(row.file_name);
      }
      for (const name of images.keys()) {
        if (!referenced.has(name)) droppedFiles.push(`uploads/${name}`);
      }

      const ignoredSettings: RestoreReport['ignoredSettings'] = [];
      for (const { key } of db.prepare('SELECT key FROM settings').all() as { key: string }[]) {
        if (isDefinedInConfig(context, key)) ignoredSettings.push({ key, reason: 'defined in the configuration file, which always wins' });
        else if (!(SETTING_KEYS as string[]).includes(key)) ignoredSettings.push({ key, reason: 'not a known setting' });
      }
      // The ignored settings and the sessions are deleted when the restore commits (BAK-4 step 6.1).

      const count = (table: string) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
      const admin = db.prepare('SELECT username, password_hash FROM admin WHERE id = 1').get() as
        { username: string; password_hash: string } | undefined;
      // A hash that fails AUTH-2 could never sign in (BAK-3).
      if (admin && parseStoredHash(admin.password_hash) === null) {
        throw new RestoreRejectedError('The backup\'s admin password hash is malformed or uses unsupported scrypt parameters.');
      }
      const currentConfig = context.config.rawText ?? '';
      report = {
        createdAt: manifest.createdAt,
        appVersion: manifest.appVersion,
        schemaVersion: SCHEMA_VERSION,
        upgradedFromSchemaVersion: version < SCHEMA_VERSION ? version : null,
        counts: { events: count('events'), holidays: count('national_holidays'), changelog: count('changelog'), images: count('images') },
        adminUsername: admin?.username ?? null,
        ignoredSettings,
        droppedFiles,
        config: {
          included: configText !== null,
          applied: false,
          text: configText,
          identical: configText !== null && configText === currentConfig,
          diff: configText !== null ? lineDiff(currentConfig, configText) : [],
        },
        preRestoreBackup: null,
        warnings: [],
      };
      db.pragma('journal_mode = DELETE');
    } finally {
      db.close();
    }
    return { dir, databaseFile, uploadsDir, report };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  } finally {
    zip.close();
  }
}

export async function previewRestore(context: AppContext, zipPath: string): Promise<RestoreReport> {
  const staged = await stageRestore(context, zipPath);
  rmSync(staged.dir, { recursive: true, force: true });
  return staged.report;
}

/** `<dataDir>/restore-failed.json`: written when a restore's rollback fails; the server refuses to start while it exists (BAK-11). */
export const RESTORE_FAILED_MARKER = 'restore-failed.json';

export function restoreFailedMarkerPath(dataDir: string): string {
  return path.join(dataDir, RESTORE_FAILED_MARKER);
}

export interface RestoreOptions {
  /** Requests of the caller's own that the drain must not wait for (the restore request itself). */
  ownActivity?: number;
  /** The restoring admin's session, kept as the recovery session if the restore fails (BAK-11). */
  session?: RecoverySession | null;
  /** Server log for the rollback `error` and the cleanup `warn` (source `backup`). */
  log?: FastifyBaseLogger;
}

/** Thrown when the restore failed but its rollback succeeded: nothing changed (BAK-10). */
const rolledBack = () => new HttpError(500, 'internal', 'The restore failed and was rolled back. Nothing was changed.');
/** Thrown when the app is left in `restore_failed` (BAK-11). */
const staysInMaintenance = () => new HttpError(500, 'internal', 'The restore failed. The app stays in maintenance.');

/**
 * Restores a backup (BAK-4): validate (step 1), take the `restore` lock and drain (2), write the pre-restore backup
 * (3), swap the files (4), migrate and check (5), commit, clean up and release (6). From `restore_failed` this is the
 * recovery restore of BAK-11: no pre-restore backup and no rollback. config.yaml is never written (BAK-5).
 */
export async function restoreBackup(context: AppContext, zipPath: string, options: RestoreOptions = {}): Promise<RestoreReport> {
  const recovery = context.operation.state === 'restore_failed';
  const staged = await stageRestore(context, zipPath);
  try {
    return await context.operation.run(
      'restore',
      () => (recovery ? applyRestore(context, staged, options, { recovery: true }) : applyRestore(context, staged, options, { recovery: false })),
      { ownActivity: options.ownActivity, session: options.session, recovery },
    );
  } finally {
    rmSync(staged.dir, { recursive: true, force: true });
  }
}

/** The step 5 health check of BAK-4, also run after a rollback. Returns the first problem, or null. */
export function restoredDataProblem(db: Db, uploadsDir: string): string | null {
  const integrity = db.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') return `the integrity check failed: ${String(integrity)}`;
  if ((db.pragma('foreign_key_check') as unknown[]).length > 0) return 'there are broken references between tables';
  const version = schemaVersion(db);
  if (version !== SCHEMA_VERSION) return `the schema version is ${version}, not ${SCHEMA_VERSION}`;
  const missing = missingTables(db);
  if (missing.length > 0) return `tables are missing: ${missing.join(', ')}`;
  for (const { file_name: fileName } of db.prepare('SELECT file_name FROM images').all() as { file_name: string }[]) {
    if (!existsSync(path.join(uploadsDir, fileName))) return `uploads/${fileName} is missing`;
  }
  return null;
}

function closeLiveDatabase(context: AppContext): void {
  if (!context.db.open) return;
  try {
    context.db.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    context.db.close();
  }
}

async function applyRestore(
  context: AppContext,
  staged: StagedRestore,
  options: RestoreOptions,
  mode: { recovery: boolean },
): Promise<RestoreReport> {
  const lock = context.operation;
  const hooks = lock.restoreHooks;
  const { databaseFile, uploadsDir } = context.config;

  // Step 3. The recovery restore skips it: the live data is the half-restored data.
  if (!mode.recovery) {
    const preRestore = await createBackup(context, { keep: true, prefix: 'pre-restore-backup' });
    staged.report.preRestoreBackup = path.basename(preRestore.path);
    lock.preRestoreBackup = staged.report.preRestoreBackup;
  }

  // Step 4: prepare the new files beside the live ones, then swap. Set-aside names never collide (BAK-4).
  const stamp = timestamp();
  const paths = {
    newDb: `${databaseFile}.restore-new-${stamp}`,
    newUploads: `${uploadsDir}.restore-new-${stamp}`,
    oldDb: `${databaseFile}.restore-old-${stamp}`,
    oldUploads: `${uploadsDir}.restore-old-${stamp}`,
  };
  const setAside = { db: false, uploads: false };
  try {
    copyFileSync(staged.databaseFile, paths.newDb);
    cpSync(staged.uploadsDir, paths.newUploads, { recursive: true });
    closeLiveDatabase(context);
    // After the TRUNCATE checkpoint the WAL is empty; the main file holds everything.
    for (const extra of ['-wal', '-shm']) rmSync(`${databaseFile}${extra}`, { force: true });
    if (existsSync(databaseFile)) { renameSync(databaseFile, paths.oldDb); setAside.db = true; }
    if (existsSync(uploadsDir)) { renameSync(uploadsDir, paths.oldUploads); setAside.uploads = true; }
    renameSync(paths.newDb, databaseFile);
    renameSync(paths.newUploads, uploadsDir);
    // Step 5: pending migrations run on open, then the health check.
    context.db = openDatabase(databaseFile);
    await hooks.afterSwap?.();
    const problem = restoredDataProblem(context.db, uploadsDir);
    if (problem) throw new Error(`The restored data failed the health check: ${problem}.`);
    // Step 6.1: commit, in one transaction on the restored data.
    const db = context.db;
    db.transaction(() => {
      const deleteSetting = db.prepare('DELETE FROM settings WHERE key = ?');
      for (const { key } of staged.report.ignoredSettings) deleteSetting.run(key);
      db.prepare('DELETE FROM sessions').run();
      hooks.inCommit?.();
    })();
  } catch (error) {
    const cause = (error as Error).message;
    if (mode.recovery) {
      // Nothing to roll back to: the state stays restore_failed, with the marker and the recovery session (BAK-11).
      lock.markFailed();
      options.log?.error({ source: 'backup', preRestoreBackup: lock.preRestoreBackup }, `The recovery restore failed: ${cause}`);
      throw staysInMaintenance();
    }
    rollBack(context, paths, setAside, options, cause);
    throw rolledBack();
  }

  // Step 6.2: clean up. The restored data is live and checked, so failures are warnings only.
  const warnings: string[] = [];
  for (const leftover of [paths.oldDb, paths.oldUploads, paths.newDb, paths.newUploads]) {
    if (!existsSync(leftover)) continue;
    try {
      hooks.cleanup?.(leftover);
      rmSync(leftover, { recursive: true, force: true });
    } catch (error) {
      warnings.push(`${leftover} could not be deleted (${(error as Error).message}). Delete it by hand once you have checked the restored data.`);
    }
  }
  if (warnings.length > 0) {
    options.log?.warn({ source: 'backup', paths: warnings.length }, `The restore succeeded, but ${warnings.length} set-aside path(s) could not be deleted: ${warnings.join(' ')}`);
  }
  // Restored data from before generated secrets existed gets its own key (ALT-2).
  asOperationOwner(() => ensureAltchaKey(context.db));
  // A successful restore ends any failed state (BAK-11); the lock clears the recovery session when it returns to idle.
  rmSync(restoreFailedMarkerPath(context.config.dataDir), { force: true });
  return { ...staged.report, warnings };
}

/** BAK-10: put the set-aside files back, reopen and re-check. If that fails too, the app stays in maintenance (BAK-11). */
function rollBack(
  context: AppContext,
  paths: { newDb: string; newUploads: string; oldDb: string; oldUploads: string },
  setAside: { db: boolean; uploads: boolean },
  options: RestoreOptions,
  cause: string,
): void {
  const lock = context.operation;
  const { databaseFile, uploadsDir } = context.config;
  try {
    if (context.db.open) context.db.close();
    if (setAside.db) {
      for (const extra of ['', '-wal', '-shm']) rmSync(`${databaseFile}${extra}`, { force: true });
      renameSync(paths.oldDb, databaseFile);
    }
    if (setAside.uploads) {
      rmSync(uploadsDir, { recursive: true, force: true });
      renameSync(paths.oldUploads, uploadsDir);
    }
    rmSync(paths.newDb, { force: true });
    rmSync(paths.newUploads, { recursive: true, force: true });
    lock.restoreHooks.rollback?.();
    context.db = openDatabase(databaseFile);
    const problem = restoredDataProblem(context.db, uploadsDir);
    if (problem) throw new Error(`the data after the rollback failed the health check: ${problem}`);
  } catch (rollbackError) {
    const reason = (rollbackError as Error).message;
    lock.markFailed();
    const marker = { preRestoreBackup: lock.preRestoreBackup, failedAt: new Date().toISOString() };
    try {
      writeFileSync(restoreFailedMarkerPath(context.config.dataDir), `${JSON.stringify(marker, null, 2)}\n`);
    } catch {
      // The server log entry below still names the pre-restore backup.
    }
    options.log?.error({ source: 'backup', preRestoreBackup: lock.preRestoreBackup, cause, rollbackError: reason },
      `The restore failed (${cause}) and so did its rollback (${reason}). The app stays in maintenance. Restore the pre-restore backup ${lock.preRestoreBackup ?? '(none)'} as described in the README (Troubleshooting).`);
    throw staysInMaintenance();
  }
  options.log?.error({ source: 'backup', cause }, `The restore failed and was rolled back: ${cause}`);
}
