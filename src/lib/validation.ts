/**
 * Validation rules shared by the browser (submission form, admin dashboard)
 * and the server (API, Migrate from Amplify, backup restore), so client and
 * server validation cannot drift apart.
 *
 * Everything in this module is pure: no DOM, no Node APIs.
 */
import { formatTranslation, getTranslations } from '../translations';
import type { Translations } from '../translations';

export const EVENT_STATUSES = ['published', 'unpublished', 'pending', 'rejected'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const LIMITS = {
  name: 200,
  type: 100,
  civilization: 200,
  location: 200,
  description: 100_000,
  link: 2_000,
  links: 20,
  agtUsername: 64,
  holidayText: 200,
  changes: 10_000,
} as const;

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEGACY_ID_PATTERN = /^[0-9a-f]{4}$/i;
const UTC_ISO_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|\+00:00)$/i;
const PORTAL_CODE_PATTERN = /^[0-9a-z]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** RFC 9562 version 4 UUID: version nibble `4`, variant bits `10xx`. */
export function isUuidV4(value: string): boolean {
  return UUID_V4_PATTERN.test(value);
}

/** Legacy Amplify-era event ID: exactly four hexadecimal characters. */
export function isLegacyEventId(value: string): boolean {
  return LEGACY_ID_PATTERN.test(value);
}

/** Canonical spelling for an event ID: UUIDs lowercase, legacy IDs uppercase. */
export function normalizeEventId(value: string): string | null {
  const trimmed = value.trim();
  if (isUuidV4(trimmed)) return trimmed.toLowerCase();
  if (isLegacyEventId(trimmed)) return trimmed.toUpperCase();
  return null;
}

export function safeHttpUrl(value: string): string | null {
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

export function parseUtcTimestamp(value: string): Date | null {
  if (!UTC_ISO_PATTERN.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isIsoDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export interface FieldError {
  field: string;
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T; notices: FieldError[] }
  | { ok: false; errors: FieldError[]; notices: FieldError[] };

/** Event fields that authors can supply. IDs, status and images are handled separately. */
export interface EventInput {
  name: string;
  start: string;
  end: string | null;
  civilization: string | null;
  type: string;
  description: string | null;
  links: string[];
  galaxy: string;
  region: string;
  system: string;
  planet: string | null;
  portalCode: string;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Markdown is kept exactly as written (only normalised line endings), never trimmed or sanitised. */
function markdown(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\r\n?/g, '\n');
  return normalized.trim() ? normalized : null;
}

function linksFrom(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  if (typeof value === 'string') {
    return value.split(/[\n,]/).map((link) => link.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Validates and normalises an event. Field names in messages use the
 * historic `EVENT_*` names so that migration reports match the source CSV.
 */
export function validateEventInput(
  raw: Record<string, unknown>,
  translations: Translations = getTranslations('en'),
): ValidationResult<EventInput> {
  const errors: FieldError[] = [];
  const notices: FieldError[] = [];

  const required = (field: string, label: string): string => {
    const value = text(raw[field]);
    if (!value) {
      errors.push({ field, message: formatTranslation(translations.fieldRequired, { field: label }) });
    }
    return value;
  };
  const maxLength = (field: string, label: string, value: string | null, max: number) => {
    if (value && value.length > max) {
      errors.push({
        field,
        message: formatTranslation(translations.fieldTooLong, { field: label, max }),
      });
    }
  };

  const name = required('name', 'EVENT_NAME');
  maxLength('name', 'EVENT_NAME', name, LIMITS.name);
  const type = required('type', 'EVENT_TYPE');
  maxLength('type', 'EVENT_TYPE', type, LIMITS.type);
  const galaxy = required('galaxy', 'EVENT_GALAXY_NAME');
  maxLength('galaxy', 'EVENT_GALAXY_NAME', galaxy, LIMITS.location);
  const region = required('region', 'EVENT_REGION_NAME');
  maxLength('region', 'EVENT_REGION_NAME', region, LIMITS.location);
  const system = required('system', 'EVENT_SYSTEM_NAME');
  maxLength('system', 'EVENT_SYSTEM_NAME', system, LIMITS.location);
  const planet = text(raw.planet) || null;
  maxLength('planet', 'EVENT_PLANET_NAME', planet, LIMITS.location);
  const civilization = text(raw.civilization) || null;
  maxLength('civilization', 'EVENT_CIV', civilization, LIMITS.civilization);

  const portalCode = required('portalCode', 'EVENT_PORTAL_CODE').toUpperCase();
  if (portalCode && !PORTAL_CODE_PATTERN.test(portalCode)) {
    errors.push({ field: 'portalCode', message: translations.portalCodeLength });
  }

  const startText = required('start', 'EVENT_DATETIME_START');
  const start = startText ? parseUtcTimestamp(startText) : null;
  if (startText && !start) {
    errors.push({ field: 'start', message: translations.startUtcTimestamp });
  }
  const endText = text(raw.end);
  const end = endText ? parseUtcTimestamp(endText) : null;
  if (endText && !end) {
    errors.push({ field: 'end', message: translations.endUtcTimestamp });
  }
  if (start && end && end.getTime() < start.getTime()) {
    errors.push({ field: 'end', message: translations.endBeforeStart });
  }

  const description = markdown(raw.description);
  maxLength('description', 'Description', description, LIMITS.description);

  const links: string[] = [];
  for (const value of linksFrom(raw.links)) {
    const safe = value.length <= LIMITS.link ? safeHttpUrl(value) : null;
    if (safe) {
      if (!links.includes(safe)) links.push(safe);
    } else {
      notices.push({
        field: 'links',
        message: formatTranslation(translations.invalidRelatedLink, { value }),
      });
    }
  }
  if (links.length > LIMITS.links) {
    errors.push({
      field: 'links',
      message: formatTranslation(translations.tooManyLinks, { max: LIMITS.links }),
    });
  }

  if (errors.length > 0 || !start) return { ok: false, errors, notices };
  return {
    ok: true,
    notices,
    value: {
      name,
      start: start.toISOString(),
      end: end ? end.toISOString() : null,
      civilization,
      type,
      description,
      links,
      galaxy,
      region,
      system,
      planet,
      portalCode,
    },
  };
}

export function validateAgtUsername(
  value: unknown,
  translations: Translations = getTranslations('en'),
): ValidationResult<string> {
  const username = text(value);
  const errors: FieldError[] = [];
  if (!username) {
    errors.push({
      field: 'agtUsername',
      message: formatTranslation(translations.fieldRequired, { field: translations.agtUsername }),
    });
  } else if (username.length > LIMITS.agtUsername) {
    errors.push({
      field: 'agtUsername',
      message: formatTranslation(translations.fieldTooLong, {
        field: translations.agtUsername,
        max: LIMITS.agtUsername,
      }),
    });
  }
  return errors.length > 0
    ? { ok: false, errors, notices: [] }
    : { ok: true, value: username, notices: [] };
}

export interface HolidayInput {
  name: string;
  civilization: string;
  date: string;
  type: string;
}

export function validateHolidayInput(
  raw: Record<string, unknown>,
  translations: Translations = getTranslations('en'),
): ValidationResult<HolidayInput> {
  const errors: FieldError[] = [];
  const value = {
    name: text(raw.name),
    civilization: text(raw.civilization),
    date: text(raw.date),
    type: text(raw.type),
  };
  const labels: Record<keyof HolidayInput, string> = {
    name: 'HOLIDAY_NAME',
    civilization: 'HOLIDAY_CIV',
    date: 'HOLIDAY_DATE',
    type: 'HOLIDAY_TYPE',
  };
  for (const field of Object.keys(labels) as (keyof HolidayInput)[]) {
    if (!value[field]) {
      errors.push({ field, message: formatTranslation(translations.fieldRequired, { field: labels[field] }) });
    } else if (value[field].length > LIMITS.holidayText) {
      errors.push({
        field,
        message: formatTranslation(translations.fieldTooLong, { field: labels[field], max: LIMITS.holidayText }),
      });
    }
  }
  if (value.date && !isIsoDate(value.date)) {
    errors.push({ field: 'date', message: translations.holidayDateFormat });
  }
  return errors.length > 0 ? { ok: false, errors, notices: [] } : { ok: true, value, notices: [] };
}

export interface ChangeLogInput {
  date: string;
  changes: string;
}

export function validateChangeLogInput(
  raw: Record<string, unknown>,
  translations: Translations = getTranslations('en'),
): ValidationResult<ChangeLogInput> {
  const errors: FieldError[] = [];
  const date = text(raw.date);
  const changes = text(raw.changes);
  if (!date) {
    errors.push({ field: 'date', message: formatTranslation(translations.fieldRequired, { field: 'Date' }) });
  } else if (!isIsoDate(date)) {
    errors.push({ field: 'date', message: translations.holidayDateFormat });
  }
  if (!changes) {
    errors.push({ field: 'changes', message: formatTranslation(translations.fieldRequired, { field: 'Changes' }) });
  } else if (changes.length > LIMITS.changes) {
    errors.push({
      field: 'changes',
      message: formatTranslation(translations.fieldTooLong, { field: 'Changes', max: LIMITS.changes }),
    });
  }
  return errors.length > 0
    ? { ok: false, errors, notices: [] }
    : { ok: true, value: { date, changes }, notices: [] };
}

/** Change-log entries keep the historic display behaviour: one bullet per comma-separated item. */
export function splitChanges(changes: string): string[] {
  return changes.split(/[,\n]/).map((value) => value.trim()).filter(Boolean);
}
