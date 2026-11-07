/**
 * Backup export and restore. A backup is one ZIP with a consistent SQLite
 * snapshot, the uploads, the current config.yaml and a checksummed manifest.
 * `.env` is never included. Restore never writes config.yaml.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SETTING_KEYS } from './config';
import type { AppContext } from './context';
import { isDefinedInConfig } from './context';
import { missingTables, openDatabase, runMigrations, schemaVersion, SCHEMA_VERSION } from './db';
import type { Db } from './db';
import { STORED_IMAGE_NAME, validateImage } from './images';
import { setting } from './context';
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

    const fileName = `${options.prefix ?? 'agt-calendar-backup'}-${timestamp()}.zip`;
    const outputPath = path.join(options.keep ? context.config.backupsDir : workDir, fileName);
    await writeZip(outputPath, files);
    if (options.keep) rmSync(workDir, { recursive: true, force: true });
    return { path: outputPath, fileName };
  } catch (error) {
    rmSync(workDir, { recursive: true, force: true });
    throw error;
  }
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
    maxEntries: setting(context, 'migration.maxEntries'),
    maxUncompressedBytes: setting(context, 'migration.maxUncompressedBytes'),
  });
  const dir = tempDir(context, 'restore');
  try {
    const byName = new Map(zip.entries.filter((entry) => !entry.isDirectory).map((entry) => [entry.name, entry]));
    for (const entry of zip.entries) {
      const allowed = entry.isDirectory
        ? entry.name === 'uploads/'
        : ['manifest.json', 'database.sqlite', 'config.yaml'].includes(entry.name) ||
          (entry.name.startsWith('uploads/') && STORED_IMAGE_NAME.test(entry.name.slice('uploads/'.length)));
      if (!allowed) throw new RestoreRejectedError(`The backup contains an unexpected path: ${entry.name}`);
    }
    const manifestEntry = byName.get('manifest.json');
    if (!manifestEntry) throw new RestoreRejectedError('The backup has no manifest.json.');
    let manifest: BackupManifest;
    try {
      manifest = JSON.parse((await zip.read(manifestEntry, 10 * 1024 * 1024)).toString('utf8')) as BackupManifest;
    } catch {
      throw new RestoreRejectedError('manifest.json is not valid JSON.');
    }
    if (manifest.format !== BACKUP_FORMAT || !Array.isArray(manifest.files)) {
      throw new RestoreRejectedError('manifest.json is not an AGT Event Calendar backup manifest.');
    }
    if (manifest.formatVersion > BACKUP_FORMAT_VERSION) {
      throw new RestoreRejectedError(`The backup format version ${manifest.formatVersion} is newer than this application supports.`);
    }
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
      const deleteSetting = db.prepare('DELETE FROM settings WHERE key = ?');
      for (const { key } of ignoredSettings) deleteSetting.run(key);
      db.prepare('DELETE FROM sessions').run();

      const count = (table: string) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
      const admin = db.prepare('SELECT username FROM admin WHERE id = 1').get() as { username: string } | undefined;
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

/**
 * Restores the database, uploads and dashboard settings. An automatic backup
 * of the current state is taken first, and files are swapped by renaming so
 * that a failure leaves the instance as it was. config.yaml is never written.
 */
export async function restoreBackup(context: AppContext, zipPath: string): Promise<RestoreReport> {
  const staged = await stageRestore(context, zipPath);
  try {
    const preRestore = await createBackup(context, { keep: true, prefix: 'pre-restore-backup' });
    staged.report.preRestoreBackup = path.basename(preRestore.path);

    const { databaseFile, uploadsDir } = context.config;
    const suffix = `.before-restore-${randomUUID()}`;
    const oldDb = `${databaseFile}${suffix}`;
    const oldUploads = `${uploadsDir}${suffix}`;
    context.db.pragma('wal_checkpoint(TRUNCATE)');
    context.db.close();
    const moved: [string, string][] = [];
    const move = (from: string, to: string) => {
      renameSync(from, to);
      moved.push([from, to]);
    };
    try {
      for (const extra of ['-wal', '-shm']) rmSync(`${databaseFile}${extra}`, { force: true });
      if (existsSync(databaseFile)) move(databaseFile, oldDb);
      if (existsSync(uploadsDir)) move(uploadsDir, oldUploads);
      move(staged.databaseFile, databaseFile);
      move(staged.uploadsDir, uploadsDir);
      context.db = openDatabase(databaseFile);
    } catch (error) {
      for (const [from, to] of moved.reverse()) {
        try {
          rmSync(from, { recursive: true, force: true });
          renameSync(to, from);
        } catch {
          // Best effort; the pre-restore backup still exists.
        }
      }
      context.db = openDatabase(databaseFile);
      throw error;
    }
    rmSync(oldDb, { force: true });
    rmSync(oldUploads, { recursive: true, force: true });
    return staged.report;
  } finally {
    rmSync(staged.dir, { recursive: true, force: true });
  }
}
