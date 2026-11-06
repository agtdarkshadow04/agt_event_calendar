/**
 * Parsers for the legacy Amplify-era Google Sheets CSV exports.
 * Used only by "Migrate from Amplify"; the running app reads events from the API.
 */
import Papa from 'papaparse';
import { formatTranslation, getTranslations } from '../translations';
import { isLegacyEventId, safeHttpUrl, validateEventInput } from './validation';
import type { EventInput, FieldError } from './validation';

export const EVENT_FIELDS = [
  'EVENT_ID',
  'EVENT_NAME',
  'EVENT_DATETIME_START',
  'EVENT_DATETIME_END',
  'EVENT_CIV',
  'EVENT_TYPE',
  'EVENT_MD_URI',
  'EVENT_COVER_IMG_URI',
  'EVENT_LINKS',
  'EVENT_GALAXY_NAME',
  'EVENT_REGION_NAME',
  'EVENT_SYSTEM_NAME',
  'EVENT_PLANET_NAME',
  'EVENT_PORTAL_CODE',
] as const;

type EventField = (typeof EVENT_FIELDS)[number];

export interface CsvTable {
  headers: string[];
  rows: { row: number; record: Record<string, string> }[];
  errors: { row: number; message: string }[];
}

/**
 * Parses CSV text with a header row. Strips a leading BOM and surrounding
 * whitespace from headers, accepts CRLF and LF, tolerates a missing final
 * newline and skips completely blank rows. Row numbers are 1-based source
 * lines as shown in a spreadsheet (the header is row 1).
 */
export function parseCsvTable(csv: string): CsvTable {
  const parsed = Papa.parse<string[]>(csv.replace(/^﻿/, ''), {
    header: false,
    skipEmptyLines: false,
  });
  const [headerRow = [], ...dataRows] = parsed.data;
  const headers = headerRow.map((header) => String(header).replace(/^﻿/, '').trim());
  const rows: CsvTable['rows'] = [];
  dataRows.forEach((cells, index) => {
    if (cells.every((cell) => !String(cell ?? '').trim())) return;
    const record: Record<string, string> = {};
    headers.forEach((header, column) => {
      if (header) record[header] = String(cells[column] ?? '').trim();
    });
    rows.push({ row: index + 2, record });
  });
  const errors = parsed.errors
    .filter((error) => error.type !== 'Delimiter')
    .map((error) => ({ row: (error.row ?? 0) + 1, message: error.message }));
  return { headers, rows, errors };
}

export interface LegacyEventRow {
  row: number;
  legacyId: string;
  input: EventInput;
  /** File name taken from the path of EVENT_MD_URI, e.g. `0000.md`. */
  markdownFile: string | null;
  /** File name taken from the path of EVENT_COVER_IMG_URI, e.g. `0001.jpg`. */
  coverFile: string | null;
  warnings: string[];
}

export interface LegacyRowError {
  row: number;
  messages: string[];
}

/** Returns the last path segment of an HTTP(S) URI, or null. */
export function fileNameFromUri(value: string): string | null {
  const url = safeHttpUrl(value);
  if (!url) return null;
  const segment = new URL(url).pathname.split('/').filter(Boolean).pop();
  if (!segment) return null;
  try {
    const decoded = decodeURIComponent(segment);
    return decoded && !/[\\/]/.test(decoded) && decoded !== '..' && decoded !== '.'
      ? decoded
      : null;
  } catch {
    return null;
  }
}

export function parseLegacyEvents(table: CsvTable): {
  events: LegacyEventRow[];
  errors: LegacyRowError[];
} {
  const translations = getTranslations('en');
  const events: LegacyEventRow[] = [];
  const errors: LegacyRowError[] = table.errors.map((error) => ({
    row: error.row,
    messages: [formatTranslation(translations.csvParser, { message: error.message })],
  }));
  const seen = new Set<string>();

  for (const { row, record } of table.rows) {
    const get = (field: EventField) => record[field] ?? '';
    const messages: string[] = [];
    const warnings: string[] = [];
    const legacyId = get('EVENT_ID').toUpperCase();
    if (!legacyId) {
      messages.push(formatTranslation(translations.fieldRequired, { field: 'EVENT_ID' }));
    } else if (!isLegacyEventId(legacyId)) {
      messages.push(translations.eventIdHex);
    } else if (seen.has(legacyId)) {
      messages.push(formatTranslation(translations.duplicateEventId, { id: legacyId }));
    }

    const result = validateEventInput({
      name: get('EVENT_NAME'),
      start: get('EVENT_DATETIME_START'),
      end: get('EVENT_DATETIME_END'),
      civilization: get('EVENT_CIV'),
      type: get('EVENT_TYPE'),
      links: get('EVENT_LINKS').split(',').map((value) => value.trim()).filter(Boolean),
      galaxy: get('EVENT_GALAXY_NAME'),
      region: get('EVENT_REGION_NAME'),
      system: get('EVENT_SYSTEM_NAME'),
      planet: get('EVENT_PLANET_NAME'),
      portalCode: get('EVENT_PORTAL_CODE'),
    }, translations);
    warnings.push(...result.notices.map((notice: FieldError) => notice.message));

    let markdownFile: string | null = null;
    if (get('EVENT_MD_URI')) {
      markdownFile = fileNameFromUri(get('EVENT_MD_URI'));
      if (!markdownFile) warnings.push(translations.unsafeDescriptionUrl);
    }
    let coverFile: string | null = null;
    if (get('EVENT_COVER_IMG_URI')) {
      coverFile = fileNameFromUri(get('EVENT_COVER_IMG_URI'));
      if (!coverFile) warnings.push(translations.unsafeCoverUrl);
    }

    if (!result.ok) messages.push(...result.errors.map((error) => error.message));
    if (messages.length > 0 || !result.ok) {
      errors.push({ row, messages });
      continue;
    }
    seen.add(legacyId);
    events.push({ row, legacyId, input: result.value, markdownFile, coverFile, warnings });
  }

  return { events, errors };
}
