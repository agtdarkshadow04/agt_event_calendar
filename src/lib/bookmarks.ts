import Papa from 'papaparse';
import { getTranslations } from '../translations';
import type { CalendarEvent } from '../types';
import { findEventByAnyId } from './api';
import { isLegacyEventId, normalizeEventId } from './validation';

export const BOOKMARKS_STORAGE_KEY = 'agt_event_calendar_bookmarks';

/**
 * Parses a single-column `EVENT_ID` CSV. Accepts UUIDv4 IDs and legacy
 * 4-hex IDs (converted to UUIDs by `migrateLegacyBookmarks` once events load).
 */
export function parseBookmarksCsv(csv: string, locale = 'en'): string[] {
  const parsed = Papa.parse<string[]>(csv, {
    delimiter: ',',
    skipEmptyLines: 'greedy',
  });
  const [header, ...rows] = parsed.data;
  const ids = rows.map((row) => (row.length === 1 ? normalizeEventId(row[0]) : null));
  if (
    parsed.errors.length > 0 ||
    header?.length !== 1 ||
    header[0].replace(/^﻿/, '').trim() !== 'EVENT_ID' ||
    ids.some((id) => id === null)
  ) {
    throw new Error(getTranslations(locale).invalidBookmarksCsv);
  }

  return [...new Set(ids as string[])];
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

/**
 * Rewrites legacy 4-hex bookmark IDs to the UUIDs of the migrated events.
 * Legacy IDs that match no event are kept so the user can see and remove them.
 */
export function migrateLegacyBookmarks(
  ids: string[],
  events: Pick<CalendarEvent, 'id' | 'legacyId'>[],
): { ids: string[]; changed: boolean } {
  let changed = false;
  const migrated = ids.map((id) => {
    if (!isLegacyEventId(id)) return id;
    const event = findEventByAnyId(events, id);
    if (!event) return id;
    changed = true;
    return event.id;
  });
  return { ids: [...new Set(migrated)], changed };
}

export function resolveBookmarks(events: CalendarEvent[], ids: string[]) {
  const bookmarkedIds = new Set(ids);
  const eventIds = new Set(events.map((event) => event.id));
  return {
    events: events.filter((event) => bookmarkedIds.has(event.id)),
    missingIds: ids.filter((id) => !eventIds.has(id)),
  };
}
