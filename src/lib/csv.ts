import Papa from 'papaparse';
import type {
  CalendarEvent,
  DataWarning,
  ParseEventsResult,
} from '../types';
import { formatTranslation, getTranslations } from '../translations';
import type { Locale, Translations } from '../translations';

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
type CsvRecord = Record<EventField, string>;

const REQUIRED_FIELDS: EventField[] = [
  'EVENT_ID',
  'EVENT_NAME',
  'EVENT_DATETIME_START',
  'EVENT_TYPE',
  'EVENT_GALAXY_NAME',
  'EVENT_REGION_NAME',
  'EVENT_SYSTEM_NAME',
  'EVENT_PORTAL_CODE',
];

const UTC_ISO_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|\+00:00)$/i;

function safeHttpUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function validUtcDate(value: string): Date | null {
  if (!UTC_ISO_PATTERN.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function optional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeRecord(record: Record<string, unknown>): CsvRecord {
  return Object.fromEntries(
    EVENT_FIELDS.map((field) => [field, String(record[field] ?? '').trim()]),
  ) as CsvRecord;
}

function parseRow(
  rawRecord: Record<string, unknown>,
  row: number,
  translations: Translations,
): { event: CalendarEvent | null; warning: DataWarning | null } {
  const record = normalizeRecord(rawRecord);
  const fatal: string[] = [];
  const notices: string[] = [];

  for (const field of REQUIRED_FIELDS) {
    if (!record[field]) {
      fatal.push(formatTranslation(translations.fieldRequired, { field }));
    }
  }

  if (record.EVENT_ID && !/^[0-9a-f]{4}$/i.test(record.EVENT_ID)) {
    fatal.push(translations.eventIdHex);
  }

  if (
    record.EVENT_PORTAL_CODE &&
    !/^[0-9a-z]{12}$/i.test(record.EVENT_PORTAL_CODE)
  ) {
    fatal.push(translations.portalCodeLength);
  }

  const start = validUtcDate(record.EVENT_DATETIME_START);
  if (record.EVENT_DATETIME_START && !start) {
    fatal.push(translations.startUtcTimestamp);
  }

  const end = record.EVENT_DATETIME_END
    ? validUtcDate(record.EVENT_DATETIME_END)
    : null;
  if (record.EVENT_DATETIME_END && !end) {
    fatal.push(translations.endUtcTimestamp);
  }
  if (start && end && end.getTime() < start.getTime()) {
    fatal.push(translations.endBeforeStart);
  }

  const descriptionUrl = record.EVENT_MD_URI
    ? safeHttpUrl(record.EVENT_MD_URI)
    : null;
  if (record.EVENT_MD_URI && !descriptionUrl) {
    notices.push(translations.unsafeDescriptionUrl);
  }

  const coverImageUrl = record.EVENT_COVER_IMG_URI
    ? safeHttpUrl(record.EVENT_COVER_IMG_URI)
    : null;
  if (record.EVENT_COVER_IMG_URI && !coverImageUrl) {
    notices.push(translations.unsafeCoverUrl);
  }

  const links = record.EVENT_LINKS
    ? record.EVENT_LINKS.split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .flatMap((value) => {
          const safe = safeHttpUrl(value);
          if (!safe) {
            notices.push(
              formatTranslation(translations.invalidRelatedLink, { value }),
            );
            return [];
          }
          return [safe];
        })
    : [];

  if (fatal.length > 0 || !start) {
    return {
      event: null,
      warning: { row, messages: [...fatal, ...notices], skipped: true },
    };
  }

  return {
    event: {
      id: record.EVENT_ID.toUpperCase(),
      name: record.EVENT_NAME,
      start,
      end,
      civilization: optional(record.EVENT_CIV),
      type: record.EVENT_TYPE,
      descriptionUrl,
      coverImageUrl,
      links,
      galaxy: record.EVENT_GALAXY_NAME,
      region: record.EVENT_REGION_NAME,
      system: record.EVENT_SYSTEM_NAME,
      planet: optional(record.EVENT_PLANET_NAME),
      portalCode: record.EVENT_PORTAL_CODE.toUpperCase(),
    },
    warning: notices.length > 0
      ? { row, messages: notices, skipped: false }
      : null,
  };
}

export function parseEventsCsv(
  csv: string,
  locale: Locale = 'en',
): ParseEventsResult {
  const translations = getTranslations(locale);
  const parsed = Papa.parse<Record<string, unknown>>(csv, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.replace(/^\uFEFF/, '').trim(),
  });

  const events: CalendarEvent[] = [];
  const eventIds = new Set<string>();
  const warnings: DataWarning[] = parsed.errors.map((error) => ({
    row: (error.row ?? 0) + 2,
    messages: [
      formatTranslation(translations.csvParser, { message: error.message }),
    ],
    skipped: false,
  }));

  const presentFields = new Set(parsed.meta.fields ?? []);
  const missingHeaders = REQUIRED_FIELDS.filter(
    (field) => !presentFields.has(field),
  );
  if (missingHeaders.length > 0) {
    warnings.unshift({
      row: 1,
      messages: [
        formatTranslation(translations.missingHeaders, {
          headers: missingHeaders.join(', '),
        }),
      ],
      skipped: false,
    });
  }

  parsed.data.forEach((record, index) => {
    const result = parseRow(record, index + 2, translations);
    if (result.event) {
      if (eventIds.has(result.event.id)) {
        warnings.push({
          row: index + 2,
          messages: [
            formatTranslation(translations.duplicateEventId, {
              id: result.event.id,
            }),
          ],
          skipped: true,
        });
      } else {
        eventIds.add(result.event.id);
        events.push(result.event);
      }
    }
    if (result.warning) warnings.push(result.warning);
  });

  events.sort((a, b) => a.start.getTime() - b.start.getTime());
  return { events, warnings };
}
