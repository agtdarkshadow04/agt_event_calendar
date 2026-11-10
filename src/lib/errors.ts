/**
 * Error codes, field codes and their translated text (AGT web app spec API-6, I18N-6). The server sends a stable
 * `error` code (and, for validation, one `FieldError` per field with a `code`) plus English `message`s; the client
 * shows every error in the user's language through `errorText()` and `fieldErrorText()` only, and falls back to the
 * server's English `message` only for a code it does not know.
 */
import { formatTranslation, getTranslations } from '../translations';

/** Every `error` code the server returns: the standard set of API-6 plus this app's own. */
export const ERROR_CODES = [
  'invalid_request', 'validation_failed', 'captcha_failed', 'unknown_setting', 'invalid_setting',
  'unauthorized', 'invalid_credentials', 'invalid_setup_password', 'csrf', 'submissions_closed', 'not_found',
  'defined_in_config', 'conflict', 'setup_complete', 'file_too_large', 'field_too_large', 'multipart_required',
  'image_rejected', 'archive_rejected', 'rate_limited', 'internal', 'setup_password_missing', 'maintenance',
  // App-specific.
  'unexpected_file',
] as const;

/** App-specific error codes that only the admin dashboard can get; their strings live in `src/admin/i18n.ts`. */
export const ADMIN_ERROR_CODES = ['file_required', 'invalid_status'] as const;

/** Every field `code`: the standard set of API-6 plus this app's own. */
export const FIELD_CODES = [
  'required', 'too_long', 'too_short', 'out_of_range', 'too_many', 'invalid_format', 'invalid_url', 'not_allowed',
  'duplicate', 'mismatch', 'same_as_setup_password',
  // App-specific.
  'end_before_start', 'link_ignored', 'image_not_found', 'file_too_large',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number] | (typeof ADMIN_ERROR_CODES)[number];
export type FieldCode = (typeof FIELD_CODES)[number];
export type ErrorParams = Record<string, string | number | boolean>;

/** A field-level validation error or a non-blocking notice (API-2, API-6). */
export interface FieldError {
  /** The request property; dotted for nested ones (`links.2`). */
  field: string;
  code: FieldCode;
  /** English text (server) or text in the form's language (shared validators in the browser). */
  message: string;
  params?: ErrorParams;
}

/** Translation tables `errorText()` and `fieldErrorText()` read: `error.<code>` and `field.<code>` keys. */
export type ErrorTranslations = Readonly<Record<string, string>>;

const MEGABYTE = 1024 * 1024;

/** Values for the placeholders: byte counts are shown in MB, every other value as it is. */
function placeholderValues(params: ErrorParams | undefined): Record<string, string | number> {
  const values: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    values[key] = key === 'maxBytes' && typeof value === 'number'
      ? `${Math.round((value / MEGABYTE) * 10) / 10} MB`
      : typeof value === 'boolean' ? String(value) : value;
  }
  return values;
}

/** A field error with its message in the given translations (English by default, as the server sends it). */
export function fieldError(
  field: string,
  code: FieldCode,
  label: string,
  params?: ErrorParams,
  translations: ErrorTranslations = getTranslations('en'),
): FieldError {
  const error: FieldError = { field, code, message: '' };
  if (params) error.params = params;
  error.message = fieldErrorText(error, label, translations);
  return error;
}

/** The translated text of a field error, with the translated field label as `{{field}}`. */
export function fieldErrorText(error: Pick<FieldError, 'code' | 'message' | 'params'>, label: string, translations: ErrorTranslations): string {
  const template = translations[`field.${error.code}`];
  if (!template) return error.message;
  return formatTranslation(template, { ...placeholderValues(error.params), field: label });
}

interface CodedError {
  code: string | null;
  message: string;
  params?: ErrorParams;
}

const isCoded = (value: unknown): value is CodedError =>
  typeof value === 'object' && value !== null && 'code' in value && 'message' in value;

/**
 * The translated text of an error: an API error's code with its params, else the server's English message for an
 * unknown code, else the error's own message.
 */
export function errorText(error: unknown, translations: ErrorTranslations): string {
  if (isCoded(error)) {
    const template = error.code ? translations[`error.${error.code}`] : undefined;
    if (template) return formatTranslation(template, placeholderValues(error.params));
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
