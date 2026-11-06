import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ADMIN_TRANSLATIONS, getAdminTranslations } from '../admin/i18n';
import { LOCALES } from '../translations';

describe('admin dashboard translations', () => {
  it('provides every admin string for every supported locale', () => {
    const englishKeys = Object.keys(ADMIN_TRANSLATIONS.en).sort();
    for (const { value } of LOCALES) {
      assert.deepEqual(Object.keys(ADMIN_TRANSLATIONS[value]).sort(), englishKeys, value);
      for (const [key, text] of Object.entries(ADMIN_TRANSLATIONS[value])) {
        assert.ok(text.trim(), `${value}.${key} is empty`);
        const placeholders = (template: string) => (template.match(/\{\{\w+\}\}/g) ?? []).sort();
        assert.deepEqual(placeholders(text), placeholders(ADMIN_TRANSLATIONS.en[key as keyof typeof ADMIN_TRANSLATIONS.en]), `${value}.${key} placeholders`);
      }
    }
  });

  it('falls back to English', () => {
    assert.equal(getAdminTranslations('xx'), ADMIN_TRANSLATIONS.en);
  });
});
