import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ADMIN_TRANSLATIONS } from '../admin/i18n';
import { LOCALES, TRANSLATIONS } from '../translations';
import { ADMIN_ERROR_CODES, ERROR_CODES, FIELD_CODES, errorText, fieldError, fieldErrorText } from './errors';
import { validateEventInput } from './validation';

// Translated errors (AGT web app spec I18N-6, TEST-4).

const placeholders = (template: string) => (template.match(/\{\{\w+\}\}/g) ?? []).sort();

describe('translated errors (I18N-6)', () => {
  it('every locale has a string for every error and field code, with the same placeholders', () => {
    for (const { value: locale } of LOCALES) {
      const publicStrings = TRANSLATIONS[locale] as Record<string, string>;
      const adminStrings = ADMIN_TRANSLATIONS[locale] as Record<string, string>;
      const english = { ...TRANSLATIONS.en, ...ADMIN_TRANSLATIONS.en } as Record<string, string>;
      const keys = [
        ...ERROR_CODES.map((code) => [publicStrings, `error.${code}`] as const),
        ...FIELD_CODES.map((code) => [publicStrings, `field.${code}`] as const),
        ...ADMIN_ERROR_CODES.map((code) => [adminStrings, `error.${code}`] as const),
      ];
      for (const [strings, key] of keys) {
        assert.ok(strings[key]?.trim(), `${locale}: ${key} is missing`);
        assert.deepEqual(placeholders(strings[key]), placeholders(english[key]), `${locale}: ${key} placeholders`);
      }
    }
    // Field strings name the field, except the ones that only make sense on their own.
    for (const code of FIELD_CODES) {
      if (['same_as_setup_password', 'link_ignored', 'image_not_found'].includes(code)) continue;
      assert.ok(TRANSLATIONS.en[`field.${code}` as keyof typeof TRANSLATIONS.en].includes('{{field}}'), code);
    }
  });

  it('translates error codes with their params, and falls back to the message for unknown codes', () => {
    const t = TRANSLATIONS.de as Record<string, string>;
    assert.equal(errorText({ code: 'rate_limited', message: 'Too many', params: { retryAfterSeconds: 42 } }, t),
      'Zu viele Anfragen. Versuchen Sie es in 42 Sekunden erneut.');
    assert.equal(errorText({ code: 'file_too_large', message: 'x', params: { maxBytes: 10 * 1024 * 1024 } }, t),
      'Die Datei ist zu groß. Die Grenze liegt bei 10 MB.');
    assert.equal(errorText({ code: 'something_new', message: 'English from a newer server.' }, t), 'English from a newer server.');
    assert.equal(errorText({ code: null, message: 'HTTP 502' }, t), 'HTTP 502');
    assert.equal(errorText(new TypeError('Failed to fetch'), t), 'Failed to fetch');
    // Admin-only codes come from the admin strings.
    assert.equal(errorText({ code: 'file_required', message: 'x' }, { ...t, ...ADMIN_TRANSLATIONS.de }), 'Wählen Sie eine Datei zum Hochladen.');
  });

  it('translates field errors with the translated label, whoever found them', () => {
    const t = TRANSLATIONS.fr as Record<string, string>;
    const server = { field: 'name', code: 'too_long' as const, message: 'EVENT_NAME must be at most 100 characters.', params: { max: 100 } };
    assert.equal(fieldErrorText(server, 'Nom', t), 'Nom doit comporter au plus 100 caractères.');
    assert.equal(fieldErrorText({ ...server, code: 'not_a_code' as never }, 'Nom', t), server.message, 'unknown code: the message');

    // The shared validators give the browser the same codes and params the server sends (FE-6).
    const checked = validateEventInput({ name: '', start: 'soon' }, TRANSLATIONS.fr);
    assert.equal(checked.ok, false);
    if (checked.ok) return;
    const byField = Object.fromEntries(checked.errors.map((error) => [error.field, error]));
    assert.equal(byField.name.code, 'required');
    assert.equal(byField.start.code, 'invalid_format');
    assert.equal(fieldErrorText(byField.name, 'Nom', t), 'Nom est obligatoire.');
    // English messages by default, as the server sends them.
    assert.deepEqual(fieldError('username', 'required', 'The admin username'),
      { field: 'username', code: 'required', message: 'The admin username is required.' });
  });
});
