/**
 * Validation rules shared by the browser (submission form, admin dashboard)
 * and the server (API, Migrate from Amplify, backup restore), so client and
 * server validation cannot drift apart.
 *
 * Everything in this module is pure: no DOM, no Node APIs.
 */
import { getTranslations } from '../translations';
import type { Translations } from '../translations';
import { fieldError } from './errors';
import type { FieldError } from './errors';

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
const PORTAL_GLYPHS_PATTERN = /^[0-9A-F]{12}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** RFC 9562 version 4 UUID: version nibble `4`, variant bits `10xx`. */
export function isUuidV4(value: string): boolean {
  return UUID_V4_PATTERN.test(value);
}

/** Legacy Amplify-era event ID: exactly four hexadecimal characters. */
export function isLegacyEventId(value: string): boolean {
  return LEGACY_ID_PATTERN.test(value);
}

/**
 * Normalises a portal code for display as glyphs: trimmed and uppercased.
 * Returns null unless it is exactly 12 hexadecimal digits, the only codes the
 * NMS Glyphs Mono font can draw. Placeholders such as `TBA` return null and
 * are shown as plain text.
 */
export function portalGlyphCode(value: string): string | null {
  const code = value.trim().toUpperCase();
  return PORTAL_GLYPHS_PATTERN.test(code) ? code : null;
}

/** True when `value` is a portal code that can be shown as glyphs (12 hexadecimal digits). */
export function isPortalCode(value: string): boolean {
  return portalGlyphCode(value) !== null;
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

export type { FieldError } from './errors';

/**
 * Keeps a more specific `message` than the code's generic text: the message is what Migrate from Amplify reports and
 * API clients read, while the UI shows the code's translated text (I18N-6).
 */
function detailed(error: FieldError, message: string): FieldError {
  return { ...error, message };
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
      errors.push(fieldError(field, 'required', label, undefined, translations));
    }
    return value;
  };
  const maxLength = (field: string, label: string, value: string | null, max: number) => {
    if (value && value.length > max) errors.push(fieldError(field, 'too_long', label, { max }, translations));
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
    errors.push(detailed(fieldError('portalCode', 'invalid_format', 'EVENT_PORTAL_CODE', undefined, translations), translations.portalCodeLength));
  }

  const startText = required('start', 'EVENT_DATETIME_START');
  const start = startText ? parseUtcTimestamp(startText) : null;
  if (startText && !start) {
    errors.push(detailed(fieldError('start', 'invalid_format', 'EVENT_DATETIME_START', undefined, translations), translations.startUtcTimestamp));
  }
  const endText = text(raw.end);
  const end = endText ? parseUtcTimestamp(endText) : null;
  if (endText && !end) {
    errors.push(detailed(fieldError('end', 'invalid_format', 'EVENT_DATETIME_END', undefined, translations), translations.endUtcTimestamp));
  }
  if (start && end && end.getTime() < start.getTime()) {
    errors.push(fieldError('end', 'end_before_start', 'EVENT_DATETIME_END', undefined, translations));
  }

  const description = markdown(raw.description);
  maxLength('description', 'Description', description, LIMITS.description);

  const links: string[] = [];
  for (const value of linksFrom(raw.links)) {
    const safe = value.length <= LIMITS.link ? safeHttpUrl(value) : null;
    if (safe) {
      if (!links.includes(safe)) links.push(safe);
    } else {
      notices.push(fieldError('links', 'link_ignored', 'EVENT_RELATED_LINKS', { value }, translations));
    }
  }
  if (links.length > LIMITS.links) {
    errors.push(fieldError('links', 'too_many', 'EVENT_RELATED_LINKS', { max: LIMITS.links }, translations));
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
    errors.push(fieldError('agtUsername', 'required', translations.agtUsername, undefined, translations));
  } else if (username.length > LIMITS.agtUsername) {
    errors.push(fieldError('agtUsername', 'too_long', translations.agtUsername, { max: LIMITS.agtUsername }, translations));
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
      errors.push(fieldError(field, 'required', labels[field], undefined, translations));
    } else if (value[field].length > LIMITS.holidayText) {
      errors.push(fieldError(field, 'too_long', labels[field], { max: LIMITS.holidayText }, translations));
    }
  }
  if (value.date && !isIsoDate(value.date)) {
    errors.push(detailed(fieldError('date', 'invalid_format', labels.date, undefined, translations), translations.holidayDateFormat));
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
    errors.push(fieldError('date', 'required', 'Date', undefined, translations));
  } else if (!isIsoDate(date)) {
    errors.push(detailed(fieldError('date', 'invalid_format', 'Date', undefined, translations), translations.holidayDateFormat));
  }
  if (!changes) {
    errors.push(fieldError('changes', 'required', 'Changes', undefined, translations));
  } else if (changes.length > LIMITS.changes) {
    errors.push(fieldError('changes', 'too_long', 'Changes', { max: LIMITS.changes }, translations));
  }
  return errors.length > 0
    ? { ok: false, errors, notices: [] }
    : { ok: true, value: { date, changes }, notices: [] };
}

/** Change-log entries keep the historic display behaviour: one bullet per comma-separated item. */
export function splitChanges(changes: string): string[] {
  return changes.split(/[,\n]/).map((value) => value.trim()).filter(Boolean);
}
