import Papa from 'papaparse';
import { getTranslations } from '../translations';
import type { CalendarEvent } from '../types';

export const BOOKMARKS_STORAGE_KEY = 'agt_event_calendar_bookmarks';

export function parseBookmarksCsv(csv: string, locale = 'en'): string[] {
  const parsed = Papa.parse<string[]>(csv, {
    delimiter: ',',
    skipEmptyLines: 'greedy',
  });
  const [header, ...rows] = parsed.data;
  if (
    parsed.errors.length > 0 ||
    header?.length !== 1 ||
    header[0].replace(/^\uFEFF/, '').trim() !== 'EVENT_ID' ||
    rows.some((row) => row.length !== 1 || !/^[0-9a-f]{4}$/i.test(row[0].trim()))
  ) {
    throw new Error(getTranslations(locale).invalidBookmarksCsv);
  }

  return [...new Set(rows.map(([id]) => id.trim().toUpperCase()))];
}

export function serializeBookmarks(ids: string[]): string {
  return Papa.unparse({ fields: ['EVENT_ID'], data: ids.map((id) => [id]) });
}

export function loadBookmarks(): string[] {
  const cached = window.localStorage.getItem(BOOKMARKS_STORAGE_KEY);
  return cached === null ? [] : parseBookmarksCsv(cached);
}

export function saveBookmarks(ids: string[]): void {
  window.localStorage.setItem(BOOKMARKS_STORAGE_KEY, serializeBookmarks(ids));
}

export function resolveBookmarks(events: CalendarEvent[], ids: string[]) {
  const bookmarkedIds = new Set(ids);
  const eventIds = new Set(events.map((event) => event.id));
  return {
    events: events.filter((event) => bookmarkedIds.has(event.id)),
    missingIds: ids.filter((id) => !eventIds.has(id)),
  };
}
