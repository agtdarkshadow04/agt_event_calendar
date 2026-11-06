import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatTranslation,
  getTranslations,
  LOCALES,
  TRANSLATIONS,
} from '../translations';

describe('interface translations', () => {
  it('provides every interface string for every supported locale', () => {
    const englishKeys = Object.keys(TRANSLATIONS.en).sort();

    for (const { value } of LOCALES) {
      assert.deepEqual(Object.keys(TRANSLATIONS[value]).sort(), englishKeys);
      assert.equal(
        Object.values(TRANSLATIONS[value]).every((translation) =>
          Boolean(translation.trim()),
        ),
        true,
      );
    }
  });

  it('falls back to English and interpolates dynamic values', () => {
    assert.equal(getTranslations('unsupported'), TRANSLATIONS.en);
    assert.equal(
      formatTranslation(TRANSLATIONS.fr.utcPreview, { value: '12:00' }),
      'UTC : 12:00',
    );
  });
});
