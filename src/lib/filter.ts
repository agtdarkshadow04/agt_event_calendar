import { effectiveEventEnd, endOfLocalDay, startOfLocalDay } from './date';
import type { CalendarEvent, EventFilters } from '../types';

function includes(value: string | null, query: string): boolean {
  return value?.toLocaleLowerCase().includes(query) ?? false;
}

export function filterEvents(
  events: CalendarEvent[],
  filters: EventFilters,
  now = new Date(),
  offsetMinutes?: number,
): CalendarEvent[] {
  const query = filters.search.trim().toLocaleLowerCase();
  const today = startOfLocalDay(now, offsetMinutes).getTime();
  const next30 = offsetMinutes === undefined
    ? endOfLocalDay(
        new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30),
      ).getTime()
    : today + 31 * 24 * 60 * 60 * 1000 - 1;

  return events.filter((event) => {
    if (filters.type && event.type !== filters.type) return false;
    if (
      filters.civilization &&
      event.civilization !== filters.civilization
    ) {
      return false;
    }
    if (filters.galaxy && event.galaxy !== filters.galaxy) return false;

    if (
      query &&
      ![
        event.id,
        event.name,
        event.type,
        event.civilization,
        event.galaxy,
        event.region,
        event.system,
        event.planet,
        event.portalCode,
      ].some((value) => includes(value, query))
    ) {
      return false;
    }

    const eventEnd = effectiveEventEnd(event, offsetMinutes).getTime();
    if (filters.dateContext === 'upcoming' && eventEnd < today) return false;
    if (
      filters.dateContext === 'next30' &&
      (eventEnd < today || event.start.getTime() > next30)
    ) {
      return false;
    }

    return true;
  });
}

export function uniqueSorted(
  values: Array<string | null | undefined>,
): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
    .sort((a, b) => a.localeCompare(b));
}

