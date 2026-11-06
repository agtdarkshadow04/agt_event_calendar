/**
 * "Migrate from Amplify": imports one operator-assembled ZIP with `csv/`,
 * `markdown/` and `covers/` at its root. Makes no network requests.
 */
import path from 'node:path';
import { EVENT_FIELDS, parseCsvTable, parseLegacyEvents } from '../src/lib/csv';
import type { LegacyEventRow, LegacyRowError } from '../src/lib/csv';
import { HOLIDAY_FIELDS, parseLegacyHolidays } from '../src/lib/holidays';
import type { HolidayInput } from '../src/lib/validation';
import type { AppContext } from './context';
import { setting } from './context';
import { ImageRejectedError, removeImageFile, validateImage, writeImageFile } from './images';
import type { ImageMime, ImageRecord } from './images';
import {
  getEventByLegacyId, holidayExists, insertEvent, insertHoliday, insertImage, setEventStatus, updateEvent,
} from './repository';
import { openSafeZip, ZipRejectedError } from './zip';
import type { SafeZip, SafeZipEntry } from './zip';

export type ExistingEventMode = 'skip' | 'overwrite';

export interface MigrationEventItem {
  row: number;
  legacyId: string;
  name: string;
  action: 'create' | 'overwrite' | 'already-migrated';
  description: boolean;
  cover: boolean;
}

export interface MigrationReport {
  dryRun: boolean;
  onExisting: ExistingEventMode;
  events: {
    toCreate: number;
    toOverwrite: number;
    alreadyMigrated: number;
    skipped: number;
    items: MigrationEventItem[];
  };
  holidays: { toCreate: number; alreadyPresent: number; skipped: number };
  descriptionsStored: number;
  coversStored: number;
  errors: { file: string; row: number; messages: string[] }[];
  warnings: string[];
  missingFiles: string[];
  unreferencedFiles: string[];
  ignoredEntries: string[];
  csvFiles: { events: string; holidays: string };
}

const CLUTTER = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
const MAX_CSV_BYTES = 50 * 1024 * 1024;
const MAX_MARKDOWN_BYTES = 1024 * 1024;

function isClutter(name: string): boolean {
  const segments = name.split('/').filter(Boolean);
  return segments[0] === '__MACOSX' || CLUTTER.has(segments[segments.length - 1] ?? '') ||
    (segments[segments.length - 1] ?? '').startsWith('._');
}

function decodeUtf8(data: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/^﻿/, '');
  } catch {
    return null;
  }
}

function sameFields(headers: string[], expected: readonly string[]): boolean {
  const present = new Set(headers.filter(Boolean));
  return present.size === expected.length && expected.every((field) => present.has(field));
}

function describeUnknownCsv(name: string, headers: string[]): string {
  const set = new Set(headers);
  if (set.has('PUBLISH') && headers.some((header) => header.startsWith('EVENT_'))) {
    return `${name} looks like the eventDB master tab. Download the publishedEventDB tab instead.`;
  }
  if (set.has('PUBLISH') && headers.some((header) => header.startsWith('HOLIDAY_'))) {
    return `${name} looks like the holidayDB master tab. Download the publishedHolidayDB tab instead.`;
  }
  return `${name} does not match the publishedEventDB or publishedHolidayDB format. ` +
    'Only those two tabs are imported; form-response tabs are never imported because they contain personal data.';
}

/** Throws when csv/, markdown/ and covers/ are not at the root of the ZIP. */
function checkLayout(entries: SafeZipEntry[]): void {
  const roots = new Map<string, Set<string>>();
  for (const { name } of entries) {
    const [root, child] = name.split('/');
    if (!roots.has(root)) roots.set(root, new Set());
    if (child !== undefined && name.split('/').length > 1) roots.get(root)!.add(child);
  }
  if (roots.has('csv')) return;
  const expected = ['csv', 'markdown', 'covers'];
  const [onlyRoot] = [...roots.keys()];
  if (roots.size === 1 && expected.some((folder) => roots.get(onlyRoot)!.has(folder))) {
    throw new ZipRejectedError(
      `csv/, markdown/ and covers/ must be at the root of the ZIP, but they are inside ${onlyRoot}/. ` +
      'Select those three folders and compress them directly.',
    );
  }
  throw new ZipRejectedError('The ZIP must contain a csv/ folder at its root with the publishedEventDB and publishedHolidayDB CSV files.');
}

interface PlannedEvent {
  source: LegacyEventRow;
  action: MigrationEventItem['action'];
  existingId: string | null;
  description: string | null;
  cover: { data: Buffer; mime: ImageMime } | null;
}

export async function migrateFromAmplify(
  context: AppContext,
  zipPath: string,
  options: { dryRun: boolean; onExisting: ExistingEventMode },
): Promise<MigrationReport> {
  const zip: SafeZip = await openSafeZip(zipPath, {
    maxEntries: setting(context, 'migration.maxEntries'),
    maxUncompressedBytes: setting(context, 'migration.maxUncompressedBytes'),
  });
  try {
    return await runMigration(context, zip, options);
  } finally {
    zip.close();
  }
}

async function runMigration(
  context: AppContext,
  zip: SafeZip,
  options: { dryRun: boolean; onExisting: ExistingEventMode },
): Promise<MigrationReport> {
  const warnings: string[] = [];
  const ignoredEntries: string[] = [];
  const relevant: SafeZipEntry[] = [];
  for (const entry of zip.entries) {
    if (isClutter(entry.name)) ignoredEntries.push(entry.name);
    else relevant.push(entry);
  }
  if (ignoredEntries.length > 0) warnings.push(`Ignored ${ignoredEntries.length} operating-system metadata entries (e.g. __MACOSX/, .DS_Store).`);

  checkLayout(relevant);

  const csvFiles: SafeZipEntry[] = [];
  const markdownFiles = new Map<string, SafeZipEntry>();
  const coverFiles = new Map<string, SafeZipEntry>();
  for (const entry of relevant) {
    if (entry.isDirectory) continue;
    const [root, ...rest] = entry.name.split('/');
    const inner = rest.join('/');
    if (root === 'csv' && rest.length === 1) csvFiles.push(entry);
    else if (root === 'markdown' && rest.length === 1) markdownFiles.set(inner, entry);
    else if (root === 'covers' && rest.length === 1) coverFiles.set(inner, entry);
    else {
      ignoredEntries.push(entry.name);
      warnings.push(`Ignored ${entry.name}: only files directly inside csv/, markdown/ and covers/ are used.`);
    }
  }

  if (csvFiles.length !== 2) {
    throw new ZipRejectedError(
      `csv/ must contain exactly two CSV files (publishedEventDB and publishedHolidayDB), but it contains ${csvFiles.length}.`,
    );
  }

  let eventsCsv: { entry: SafeZipEntry; text: string } | null = null;
  let holidaysCsv: { entry: SafeZipEntry; text: string } | null = null;
  for (const entry of csvFiles) {
    const text = decodeUtf8(await zip.read(entry, MAX_CSV_BYTES));
    if (text === null) throw new ZipRejectedError(`${entry.name} is not valid UTF-8 text.`);
    const { headers } = parseCsvTable(text.split(/\r?\n/, 1)[0] ?? '');
    if (sameFields(headers, EVENT_FIELDS)) {
      if (eventsCsv) throw new ZipRejectedError(`Both ${eventsCsv.entry.name} and ${entry.name} are publishedEventDB CSVs; csv/ needs one of each.`);
      eventsCsv = { entry, text };
    } else if (sameFields(headers, HOLIDAY_FIELDS)) {
      if (holidaysCsv) throw new ZipRejectedError(`Both ${holidaysCsv.entry.name} and ${entry.name} are publishedHolidayDB CSVs; csv/ needs one of each.`);
      holidaysCsv = { entry, text };
    } else {
      throw new ZipRejectedError(describeUnknownCsv(entry.name, headers));
    }
  }
  if (!eventsCsv || !holidaysCsv) throw new ZipRejectedError('csv/ must contain one publishedEventDB CSV and one publishedHolidayDB CSV.');

  const parsedEvents = parseLegacyEvents(parseCsvTable(eventsCsv.text));
  const parsedHolidays = parseLegacyHolidays(parseCsvTable(holidaysCsv.text));
  const errors = [
    ...parsedEvents.errors.map((error: LegacyRowError) => ({ file: eventsCsv!.entry.name, ...error })),
    ...parsedHolidays.errors.map((error: LegacyRowError) => ({ file: holidaysCsv!.entry.name, ...error })),
  ];

  const referencedMarkdown = new Set<string>();
  const referencedCovers = new Set<string>();
  const missingFiles: string[] = [];
  const maxImageBytes = setting(context, 'uploads.maxImageBytes');
  const planned: PlannedEvent[] = [];

  for (const source of parsedEvents.events) {
    for (const warning of source.warnings) warnings.push(`Event ${source.legacyId} (row ${source.row}): ${warning}`);
    if (source.markdownFile) referencedMarkdown.add(source.markdownFile);
    if (source.coverFile) referencedCovers.add(source.coverFile);

    const existing = getEventByLegacyId(context.db, source.legacyId);
    const action: MigrationEventItem['action'] = !existing
      ? 'create'
      : options.onExisting === 'overwrite' ? 'overwrite' : 'already-migrated';
    const plan: PlannedEvent = { source, action, existingId: existing?.id ?? null, description: null, cover: null };
    planned.push(plan);
    if (action === 'already-migrated') continue;

    if (source.markdownFile) {
      const entry = markdownFiles.get(source.markdownFile);
      if (!entry) {
        missingFiles.push(`markdown/${source.markdownFile}`);
        warnings.push(`Event ${source.legacyId}: markdown/${source.markdownFile} is missing; imported without a description.`);
      } else if (entry.size > MAX_MARKDOWN_BYTES) {
        warnings.push(`Event ${source.legacyId}: markdown/${source.markdownFile} is larger than 1 MB; imported without a description.`);
      } else {
        const text = decodeUtf8(await zip.read(entry, MAX_MARKDOWN_BYTES));
        if (text === null) warnings.push(`Event ${source.legacyId}: markdown/${source.markdownFile} is not valid UTF-8 text; imported without a description.`);
        else plan.description = text.replace(/\r\n?/g, '\n');
      }
    }

    if (source.coverFile) {
      const entry = coverFiles.get(source.coverFile);
      if (!entry) {
        missingFiles.push(`covers/${source.coverFile}`);
        warnings.push(`Event ${source.legacyId}: covers/${source.coverFile} is missing; imported without a cover.`);
      } else if (entry.size > maxImageBytes) {
        warnings.push(`Event ${source.legacyId}: covers/${source.coverFile} is larger than the image size limit; imported without a cover.`);
      } else {
        const data = await zip.read(entry, maxImageBytes);
        try {
          plan.cover = { data, mime: validateImage(data, { maxBytes: maxImageBytes, fileName: source.coverFile }) };
        } catch (error) {
          if (!(error instanceof ImageRejectedError)) throw error;
          warnings.push(`Event ${source.legacyId}: covers/${source.coverFile} was rejected (${error.message}); imported without a cover.`);
        }
      }
    }
  }

  const holidayPlan = parsedHolidays.holidays.map(({ input }) => ({
    input,
    exists: holidayExists(context.db, input),
  }));
  const unreferencedFiles = [
    ...[...markdownFiles.keys()].filter((name) => !referencedMarkdown.has(name)).map((name) => `markdown/${name}`),
    ...[...coverFiles.keys()].filter((name) => !referencedCovers.has(name)).map((name) => `covers/${name}`),
  ].sort();

  const writing = planned.filter((plan) => plan.action !== 'already-migrated');
  const report: MigrationReport = {
    dryRun: options.dryRun,
    onExisting: options.onExisting,
    events: {
      toCreate: planned.filter((plan) => plan.action === 'create').length,
      toOverwrite: planned.filter((plan) => plan.action === 'overwrite').length,
      alreadyMigrated: planned.filter((plan) => plan.action === 'already-migrated').length,
      skipped: parsedEvents.errors.length,
      items: planned.map((plan) => ({
        row: plan.source.row,
        legacyId: plan.source.legacyId,
        name: plan.source.input.name,
        action: plan.action,
        description: plan.description !== null,
        cover: plan.cover !== null,
      })),
    },
    holidays: {
      toCreate: holidayPlan.filter((holiday) => !holiday.exists).length,
      alreadyPresent: holidayPlan.filter((holiday) => holiday.exists).length,
      skipped: parsedHolidays.errors.length,
    },
    descriptionsStored: writing.filter((plan) => plan.description !== null).length,
    coversStored: writing.filter((plan) => plan.cover !== null).length,
    errors,
    warnings,
    missingFiles,
    unreferencedFiles,
    ignoredEntries,
    csvFiles: { events: eventsCsv.entry.name, holidays: holidaysCsv.entry.name },
  };
  if (options.dryRun) return report;

  commit(context, writing, holidayPlan.filter((holiday) => !holiday.exists).map((holiday) => holiday.input));
  return report;
}

/** Stores images, then writes everything in one transaction; images are removed again if it fails. */
function commit(context: AppContext, writing: PlannedEvent[], holidays: HolidayInput[]): void {
  const uploadsDir = context.config.uploadsDir;
  const written: ImageRecord[] = [];
  try {
    const covers = new Map<PlannedEvent, ImageRecord>();
    for (const plan of writing) {
      if (!plan.cover) continue;
      const image = writeImageFile(uploadsDir, plan.cover.data, plan.cover.mime);
      written.push(image);
      covers.set(plan, image);
    }
    context.db.transaction(() => {
      for (const image of written) insertImage(context.db, image);
      for (const plan of writing) {
        const input = { ...plan.source.input, description: plan.description };
        const coverImageId = covers.get(plan)?.id ?? null;
        if (plan.action === 'overwrite' && plan.existingId) {
          updateEvent(context.db, plan.existingId, input, coverImageId);
          setEventStatus(context.db, plan.existingId, 'published');
        } else {
          insertEvent(context.db, input, { status: 'published', legacyId: plan.source.legacyId, coverImageId });
        }
      }
      for (const holiday of holidays) insertHoliday(context.db, holiday, true);
    })();
  } catch (error) {
    for (const image of written) removeImageFile(uploadsDir, path.basename(image.fileName));
    throw error;
  }
}
