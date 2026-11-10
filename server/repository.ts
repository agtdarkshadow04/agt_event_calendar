import { randomUUID } from 'node:crypto';
import type { AdminApiChangeLogEntry, AdminApiEvent, AdminApiHoliday } from '../src/lib/api';
import type { ChangeLogInput, EventInput, EventStatus, HolidayInput } from '../src/lib/validation';
import type { Db } from './db';
import type { ImageRecord } from './images';
import { assertDataWrite } from './dataWrite';

const now = () => new Date().toISOString();

// ---------------------------------------------------------------- events

interface EventRow {
  id: string;
  legacy_id: string | null;
  name: string;
  start_utc: string;
  end_utc: string | null;
  civilization: string | null;
  type: string;
  description_md: string | null;
  cover_image_id: string | null;
  galaxy: string;
  region: string;
  system: string;
  planet: string | null;
  portal_code: string;
  status: EventStatus;
  submitter_agt_username: string | null;
  created_at: string;
  updated_at: string;
}

function linksFor(db: Db, ids: string[]): Map<string, string[]> {
  const links = new Map<string, string[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return links;
  const rows = db.prepare(
    'SELECT event_id, url FROM event_links ORDER BY event_id, position',
  ).all() as { event_id: string; url: string }[];
  for (const row of rows) links.get(row.event_id)?.push(row.url);
  return links;
}

function toAdminEvent(row: EventRow, links: string[]): AdminApiEvent {
  return {
    id: row.id,
    legacyId: row.legacy_id,
    name: row.name,
    start: row.start_utc,
    end: row.end_utc,
    civilization: row.civilization,
    type: row.type,
    description: row.description_md,
    coverImageId: row.cover_image_id,
    links,
    galaxy: row.galaxy,
    region: row.region,
    system: row.system,
    planet: row.planet,
    portalCode: row.portal_code,
    status: row.status,
    submitterAgtUsername: row.submitter_agt_username,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listEvents(db: Db, statuses?: EventStatus[]): AdminApiEvent[] {
  const rows = (statuses
    ? db.prepare(
      `SELECT * FROM events WHERE status IN (${statuses.map(() => '?').join(',')}) ORDER BY start_utc, name`,
    ).all(...statuses)
    : db.prepare('SELECT * FROM events ORDER BY start_utc, name').all()) as EventRow[];
  const links = linksFor(db, rows.map((row) => row.id));
  return rows.map((row) => toAdminEvent(row, links.get(row.id) ?? []));
}

export function getEvent(db: Db, id: string): AdminApiEvent | null {
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id.toLowerCase()) as EventRow | undefined;
  if (!row) return null;
  const links = (db.prepare('SELECT url FROM event_links WHERE event_id = ? ORDER BY position').all(row.id) as { url: string }[])
    .map((link) => link.url);
  return toAdminEvent(row, links);
}

export function getEventByLegacyId(db: Db, legacyId: string): AdminApiEvent | null {
  const row = db.prepare('SELECT id FROM events WHERE legacy_id = ?').get(legacyId.toUpperCase()) as { id: string } | undefined;
  return row ? getEvent(db, row.id) : null;
}

function writeLinks(db: Db, id: string, links: string[]) {
  db.prepare('DELETE FROM event_links WHERE event_id = ?').run(id);
  const insert = db.prepare('INSERT INTO event_links (event_id, position, url) VALUES (?, ?, ?)');
  links.forEach((url, position) => insert.run(id, position, url));
}

export function insertEvent(
  db: Db,
  input: EventInput,
  options: { status: EventStatus; legacyId?: string | null; coverImageId?: string | null; submitterAgtUsername?: string | null },
): string {
  assertDataWrite('insertEvent()');
  const id = randomUUID();
  const timestamp = now();
  db.prepare(`INSERT INTO events (
      id, legacy_id, name, start_utc, end_utc, civilization, type, description_md, cover_image_id,
      galaxy, region, system, planet, portal_code, status, submitter_agt_username, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, options.legacyId ?? null, input.name, input.start, input.end, input.civilization, input.type,
    input.description, options.coverImageId ?? null, input.galaxy, input.region, input.system, input.planet,
    input.portalCode, options.status, options.submitterAgtUsername ?? null, timestamp, timestamp,
  );
  writeLinks(db, id, input.links);
  return id;
}

export function updateEvent(db: Db, id: string, input: EventInput, coverImageId: string | null): boolean {
  assertDataWrite('updateEvent()');
  const result = db.prepare(`UPDATE events SET
      name = ?, start_utc = ?, end_utc = ?, civilization = ?, type = ?, description_md = ?, cover_image_id = ?,
      galaxy = ?, region = ?, system = ?, planet = ?, portal_code = ?, updated_at = ?
    WHERE id = ?`).run(
    input.name, input.start, input.end, input.civilization, input.type, input.description, coverImageId,
    input.galaxy, input.region, input.system, input.planet, input.portalCode, now(), id,
  );
  if (result.changes === 0) return false;
  writeLinks(db, id, input.links);
  return true;
}

export function setEventStatus(db: Db, id: string, status: EventStatus): boolean {
  assertDataWrite('setEventStatus()');
  return db.prepare('UPDATE events SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id).changes > 0;
}

export function deleteEvent(db: Db, id: string): boolean {
  assertDataWrite('deleteEvent()');
  return db.prepare('DELETE FROM events WHERE id = ?').run(id).changes > 0;
}

// ---------------------------------------------------------------- holidays

interface HolidayRow { id: string; name: string; civilization: string; date: string; type: string; published: number }

const toHoliday = (row: HolidayRow): AdminApiHoliday => ({
  id: row.id, name: row.name, civilization: row.civilization, date: row.date, type: row.type, published: row.published === 1,
});

export function listHolidays(db: Db, publishedOnly: boolean): AdminApiHoliday[] {
  return (db.prepare(
    `SELECT * FROM national_holidays ${publishedOnly ? 'WHERE published = 1' : ''} ORDER BY substr(date, 6), name`,
  ).all() as HolidayRow[]).map(toHoliday);
}

export function getHoliday(db: Db, id: string): AdminApiHoliday | null {
  const row = db.prepare('SELECT * FROM national_holidays WHERE id = ?').get(id) as HolidayRow | undefined;
  return row ? toHoliday(row) : null;
}

export function holidayExists(db: Db, input: HolidayInput): boolean {
  return db.prepare(
    'SELECT 1 FROM national_holidays WHERE name = ? AND civilization = ? AND date = ? AND type = ?',
  ).get(input.name, input.civilization, input.date, input.type) !== undefined;
}

export function insertHoliday(db: Db, input: HolidayInput, published: boolean): string {
  assertDataWrite('insertHoliday()');
  const id = randomUUID();
  const timestamp = now();
  db.prepare(`INSERT INTO national_holidays (id, name, civilization, date, type, published, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.name, input.civilization, input.date, input.type, published ? 1 : 0, timestamp, timestamp);
  return id;
}

export function updateHoliday(db: Db, id: string, input: HolidayInput, published: boolean): boolean {
  assertDataWrite('updateHoliday()');
  return db.prepare(`UPDATE national_holidays SET name = ?, civilization = ?, date = ?, type = ?, published = ?, updated_at = ?
    WHERE id = ?`).run(input.name, input.civilization, input.date, input.type, published ? 1 : 0, now(), id).changes > 0;
}

export function deleteHoliday(db: Db, id: string): boolean {
  assertDataWrite('deleteHoliday()');
  return db.prepare('DELETE FROM national_holidays WHERE id = ?').run(id).changes > 0;
}

// ---------------------------------------------------------------- change log

interface ChangeLogRow { id: string; date: string; changes: string; published: number }

const toChangeLog = (row: ChangeLogRow): AdminApiChangeLogEntry => ({
  id: row.id, date: row.date, changes: row.changes, published: row.published === 1,
});

export function listChangeLog(db: Db, publishedOnly: boolean): AdminApiChangeLogEntry[] {
  return (db.prepare(
    `SELECT * FROM changelog ${publishedOnly ? 'WHERE published = 1' : ''} ORDER BY date DESC, created_at DESC`,
  ).all() as ChangeLogRow[]).map(toChangeLog);
}

export function getChangeLog(db: Db, id: string): AdminApiChangeLogEntry | null {
  const row = db.prepare('SELECT * FROM changelog WHERE id = ?').get(id) as ChangeLogRow | undefined;
  return row ? toChangeLog(row) : null;
}

export function insertChangeLog(db: Db, input: ChangeLogInput, published: boolean): string {
  assertDataWrite('insertChangeLog()');
  const id = randomUUID();
  const timestamp = now();
  db.prepare('INSERT INTO changelog (id, date, changes, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, input.date, input.changes, published ? 1 : 0, timestamp, timestamp);
  return id;
}

export function updateChangeLog(db: Db, id: string, input: ChangeLogInput, published: boolean): boolean {
  assertDataWrite('updateChangeLog()');
  return db.prepare('UPDATE changelog SET date = ?, changes = ?, published = ?, updated_at = ? WHERE id = ?')
    .run(input.date, input.changes, published ? 1 : 0, now(), id).changes > 0;
}

export function deleteChangeLog(db: Db, id: string): boolean {
  assertDataWrite('deleteChangeLog()');
  return db.prepare('DELETE FROM changelog WHERE id = ?').run(id).changes > 0;
}

// ---------------------------------------------------------------- images

interface ImageRow {
  id: string; file_name: string; mime_type: ImageRecord['mimeType']; size_bytes: number; sha256: string; created_at: string; updated_at: string;
}

const toImage = (row: ImageRow): ImageRecord => ({
  id: row.id, fileName: row.file_name, mimeType: row.mime_type, sizeBytes: row.size_bytes, sha256: row.sha256,
  createdAt: row.created_at, updatedAt: row.updated_at,
});

export function insertImage(db: Db, image: ImageRecord): void {
  assertDataWrite('insertImage()');
  db.prepare('INSERT INTO images (id, file_name, mime_type, size_bytes, sha256, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(image.id, image.fileName, image.mimeType, image.sizeBytes, image.sha256, image.createdAt, image.updatedAt);
}

export function getImage(db: Db, id: string): ImageRecord | null {
  const row = db.prepare('SELECT * FROM images WHERE id = ?').get(id) as ImageRow | undefined;
  return row ? toImage(row) : null;
}

export function listImages(db: Db): (ImageRecord & { referencedBy: { id: string; name: string; status: EventStatus }[] })[] {
  const images = (db.prepare('SELECT * FROM images ORDER BY created_at DESC').all() as ImageRow[]).map(toImage);
  const refs = db.prepare('SELECT id, name, status, cover_image_id FROM events WHERE cover_image_id IS NOT NULL').all() as
    { id: string; name: string; status: EventStatus; cover_image_id: string }[];
  return images.map((image) => ({
    ...image,
    referencedBy: refs.filter((ref) => ref.cover_image_id === image.id).map(({ id, name, status }) => ({ id, name, status })),
  }));
}

/** Points an image row at a new file (used when an admin replaces an image). */
export function replaceImageRow(db: Db, id: string, replacement: ImageRecord): void {
  assertDataWrite('replaceImageRow()');
  db.prepare('UPDATE images SET file_name = ?, mime_type = ?, size_bytes = ?, sha256 = ?, updated_at = ? WHERE id = ?')
    .run(replacement.fileName, replacement.mimeType, replacement.sizeBytes, replacement.sha256, replacement.updatedAt, id);
}

export function deleteImageRow(db: Db, id: string): ImageRecord | null {
  assertDataWrite('deleteImageRow()');
  const image = getImage(db, id);
  if (!image) return null;
  db.prepare('DELETE FROM images WHERE id = ?').run(id);
  return image;
}

export function unreferencedImages(db: Db): ImageRecord[] {
  return (db.prepare(
    'SELECT * FROM images WHERE id NOT IN (SELECT cover_image_id FROM events WHERE cover_image_id IS NOT NULL)',
  ).all() as ImageRow[]).map(toImage);
}

// ---------------------------------------------------------------- settings

export function getSettingRows(db: Db): Map<string, unknown> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const settings = new Map<string, unknown>();
  for (const row of rows) {
    try {
      settings.set(row.key, JSON.parse(row.value));
    } catch {
      // Ignore corrupt values; the default applies.
    }
  }
  return settings;
}

export function setSetting(db: Db, key: string, value: unknown): void {
  assertDataWrite('setSetting()');
  const timestamp = now();
  db.prepare(`INSERT INTO settings (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(key, JSON.stringify(value), timestamp, timestamp);
}

export function deleteSetting(db: Db, key: string): void {
  assertDataWrite('deleteSetting()');
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

// ---------------------------------------------------------------- admin & sessions

export interface AdminRow { username: string; password_hash: string }

export function getAdmin(db: Db): AdminRow | null {
  return (db.prepare('SELECT username, password_hash FROM admin WHERE id = 1').get() as AdminRow | undefined) ?? null;
}

/** Creates the single admin account. Returns false if one already exists. */
export function createAdmin(db: Db, username: string, passwordHash: string): boolean {
  assertDataWrite('createAdmin()');
  const timestamp = now();
  return db.prepare(`INSERT OR IGNORE INTO admin (id, username, password_hash, created_at, updated_at)
    VALUES (1, ?, ?, ?, ?)`).run(username, passwordHash, timestamp, timestamp).changes > 0;
}

export function updateAdminPassword(db: Db, passwordHash: string): void {
  assertDataWrite('updateAdminPassword()');
  db.prepare('UPDATE admin SET password_hash = ?, updated_at = ? WHERE id = 1').run(passwordHash, now());
}

export function createSession(db: Db, tokenHash: string, ttlHours: number): string {
  const created = new Date();
  const expires = new Date(created.getTime() + ttlHours * 3600_000).toISOString();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(created.toISOString());
  db.prepare('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)')
    .run(tokenHash, created.toISOString(), expires);
  return expires;
}

export function sessionValid(db: Db, tokenHash: string): boolean {
  return db.prepare('SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at > ?').get(tokenHash, now()) !== undefined;
}

export function deleteSession(db: Db, tokenHash: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

export function deleteAllSessions(db: Db): void {
  db.prepare('DELETE FROM sessions').run();
}

// ---------------------------------------------------------------- secrets & ALTCHA replay protection

/** Stores a generated secret unless one with this name exists. Called at startup and after a restore only (SEC-8). */
export function createSecretIfMissing(db: Db, name: string, create: () => string): boolean {
  assertDataWrite('createSecretIfMissing()');
  if (getSecret(db, name) !== null) return false;
  const timestamp = now();
  return db.prepare('INSERT OR IGNORE INTO app_secrets (name, value, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(name, create(), timestamp, timestamp).changes > 0;
}

export function getSecret(db: Db, name: string): string | null {
  return (db.prepare('SELECT value FROM app_secrets WHERE name = ?').get(name) as { value: string } | undefined)?.value ?? null;
}

/** Atomically marks an ALTCHA challenge as used. Returns false if it already was. */
export function markAltchaUsed(db: Db, challengeId: string, ttlSeconds: number): boolean {
  assertDataWrite('markAltchaUsed()');
  const nowSeconds = Math.floor(Date.now() / 1000);
  db.prepare('DELETE FROM altcha_used WHERE expires_at < ?').run(nowSeconds);
  return db.prepare('INSERT OR IGNORE INTO altcha_used (challenge_id, expires_at) VALUES (?, ?)')
    .run(challengeId, nowSeconds + ttlSeconds * 2).changes > 0;
}
