/**
 * Shapes of the JSON API shared by the server and the browser, plus pure
 * helpers for turning API responses into UI models.
 */
import type { CalendarEvent } from '../types';
import { normalizeEventId } from './validation';
import type { EventStatus } from './validation';

export interface ApiEvent {
  id: string;
  legacyId: string | null;
  name: string;
  start: string;
  end: string | null;
  civilization: string | null;
  type: string;
  description: string | null;
  coverImageId: string | null;
  links: string[];
  galaxy: string;
  region: string;
  system: string;
  planet: string | null;
  portalCode: string;
}

export interface AdminApiEvent extends ApiEvent {
  status: EventStatus;
  submitterAgtUsername: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiHoliday {
  id: string;
  name: string;
  civilization: string;
  date: string;
  type: string;
}

export interface AdminApiHoliday extends ApiHoliday {
  published: boolean;
}

export interface ApiChangeLogEntry {
  id: string;
  date: string;
  changes: string;
}

export interface AdminApiChangeLogEntry extends ApiChangeLogEntry {
  published: boolean;
}

export interface PublicSettings {
  siteTitle: string;
  supportUrl: string;
  glyphToolUrl: string;
  submissionsEnabled: boolean;
  maxImageBytes: number;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: { field: string; message: string }[];
  /** Values the message needs, e.g. `{ retryAfterSeconds }` for `maintenance` (API-6). */
  params?: Record<string, string | number | boolean>;
}

export function imageUrl(imageId: string): string {
  return `/api/images/${encodeURIComponent(imageId)}`;
}

export function toCalendarEvent(event: ApiEvent): CalendarEvent {
  return {
    id: event.id,
    legacyId: event.legacyId,
    name: event.name,
    start: new Date(event.start),
    end: event.end ? new Date(event.end) : null,
    civilization: event.civilization,
    type: event.type,
    description: event.description,
    coverImageUrl: event.coverImageId ? imageUrl(event.coverImageId) : null,
    links: event.links,
    galaxy: event.galaxy,
    region: event.region,
    system: event.system,
    planet: event.planet,
    portalCode: event.portalCode,
  };
}

/**
 * Resolves an event ID from a deep link or bookmark. UUIDs match `id`;
 * legacy 4-hex IDs match `legacyId`. Returns null when nothing matches.
 */
export function findEventByAnyId<T extends { id: string; legacyId: string | null }>(
  events: T[],
  value: string,
): T | null {
  const id = normalizeEventId(value);
  if (!id) return null;
  return events.find((event) =>
    id.length === 4 ? event.legacyId?.toUpperCase() === id : event.id.toLowerCase() === id,
  ) ?? null;
}
