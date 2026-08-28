export const FONT_SCALES = ['1x', '1.5x', '2x'] as const;

export const LOCALES = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français (French)' },
  { value: 'de', label: 'Deutsch (German)' },
  { value: 'es', label: 'Español (Spanish)' },
  { value: 'pt', label: 'Português (Portuguese (Brazilian))' },
  { value: 'it', label: 'Italiano (Italian)' },
  { value: 'th', label: 'ไทย (Thai)' },
  { value: 'zh', label: '中文 (Mandarin Chinese)' },
  { value: 'hi', label: 'हिन्दी (Hindi)' },
  { value: 'ja', label: '日本語 (Japanese)' },
] as const;

const UTC_OFFSETS = [
  -720, -660, -600, -570, -540, -480, -420, -360, -300, -240, -210,
  -180, -120, -60, 60, 120, 180, 210, 240, 270, 300, 330, 345, 360,
  390, 420, 480, 525, 540, 570, 600, 630, 660, 720, 765, 780, 825, 840,
] as const;

export type FontScale = (typeof FONT_SCALES)[number];
export type Locale = (typeof LOCALES)[number]['value'];
export type AnthemSetting = 'mute' | 'unmute';

export interface AppSettings {
  fontScale: FontScale;
  locale: Locale;
  timeZone: string;
  anthem: AnthemSetting;
}

export const SETTINGS_STORAGE_KEY = 'agt_event_calendar_settings';
export const AUTO_TIME_ZONE = 'Auto';

export function formatUtcOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
  const minutes = String(absolute % 60).padStart(2, '0');
  return `UTC${sign}${hours}:${minutes}`;
}

export const TIME_ZONE_OPTIONS = [
  { value: AUTO_TIME_ZONE, label: AUTO_TIME_ZONE, offsetMinutes: null },
  ...UTC_OFFSETS.map((offsetMinutes) => ({
    value: formatUtcOffset(offsetMinutes),
    label: formatUtcOffset(offsetMinutes),
    offsetMinutes,
  })),
];

const FONT_SCALE_SET = new Set<string>(FONT_SCALES);
const LOCALE_SET = new Set<string>(LOCALES.map((locale) => locale.value));
const TIME_ZONE_SET = new Set(TIME_ZONE_OPTIONS.map((timeZone) => timeZone.value));

export function browserTimeZone(now = new Date()): string {
  return formatUtcOffset(-now.getTimezoneOffset());
}

export function createDefaultSettings(): AppSettings {
  return {
    fontScale: '1x',
    locale: 'en',
    timeZone: AUTO_TIME_ZONE,
    anthem: 'unmute',
  };
}

export function resolveTimeZone(
  timeZone: string,
  now = new Date(),
): { label: string; offsetMinutes: number } {
  if (timeZone === AUTO_TIME_ZONE) {
    const browserOffset = now.getTimezoneOffset();
    return {
      label: browserTimeZone(now),
      offsetMinutes: browserOffset === 0 ? 0 : -browserOffset,
    };
  }

  return { label: timeZone, offsetMinutes: parseUtcOffset(timeZone) };
}

export function parseUtcOffset(timeZone: string): number {
  const match = /^UTC([+-])(\d{2}):(\d{2})$/.exec(timeZone);
  if (!match || !TIME_ZONE_SET.has(timeZone)) {
    throw new Error('The timezone must be one of the supported UTC offset zones.');
  }

  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseSettingsJson(json: string): AppSettings {
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed)) {
    throw new Error('Settings JSON must contain an object.');
  }

  if (!FONT_SCALE_SET.has(String(parsed.fontScale))) {
    throw new Error('Settings JSON contains an unsupported font scale.');
  }
  if (!LOCALE_SET.has(String(parsed.locale))) {
    throw new Error('Settings JSON contains an unsupported locale.');
  }
  if (!TIME_ZONE_SET.has(String(parsed.timeZone))) {
    throw new Error('Settings JSON contains an unsupported timezone.');
  }
  if (parsed.anthem !== 'mute' && parsed.anthem !== 'unmute') {
    throw new Error('Settings JSON contains an unsupported anthem setting.');
  }

  return {
    fontScale: parsed.fontScale as FontScale,
    locale: parsed.locale as Locale,
    timeZone: parsed.timeZone as string,
    anthem: parsed.anthem,
  };
}

export function loadSettings(): AppSettings {
  const defaults = createDefaultSettings();
  try {
    const cached = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    return cached ? parseSettingsJson(cached) : defaults;
  } catch (error: unknown) {
    console.error('Unable to load cached calendar settings', error);
    return defaults;
  }
}

export function saveSettings(settings: AppSettings): void {
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}
