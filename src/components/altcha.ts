/**
 * Bundled, self-hosted ALTCHA widget. The `external` build ships no inline
 * styles or blob: workers, so it works under the app's strict CSP; the SHA
 * proof-of-work worker is bundled by Vite as a same-origin file.
 */
import 'altcha/external';
import 'altcha/altcha.css';
import 'altcha/types/react';
import 'altcha/i18n/en';
import 'altcha/i18n/fr-fr';
import 'altcha/i18n/de';
import 'altcha/i18n/es-es';
import 'altcha/i18n/pt-br';
import 'altcha/i18n/it';
import 'altcha/i18n/th';
import 'altcha/i18n/zh-cn';
import 'altcha/i18n/hi';
import 'altcha/i18n/ja';
import ShaWorker from 'altcha/workers/sha?worker';

for (const algorithm of ['SHA-256', 'SHA-384', 'SHA-512']) {
  globalThis.$altcha.algorithms.set(algorithm, () => new ShaWorker());
}

const ALTCHA_LANGUAGES: Record<string, string> = {
  en: 'en', fr: 'fr-fr', de: 'de', es: 'es-es', pt: 'pt-br', it: 'it', th: 'th', zh: 'zh-cn', hi: 'hi', ja: 'ja',
};

export function altchaLanguage(locale: string): string {
  return ALTCHA_LANGUAGES[locale] ?? 'en';
}
