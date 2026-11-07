import type { CalendarEvent } from '../types';

const MILLISECONDS_PER_MINUTE = 60_000;
const MILLISECONDS_PER_DAY = 86_400_000;

function offsetDate(date: Date, offsetMinutes: number): Date {
  return new Date(date.getTime() + offsetMinutes * MILLISECONDS_PER_MINUTE);
}

function offsetDayValue(date: Date, offsetMinutes: number): number {
  const shifted = offsetDate(date, offsetMinutes);
  return Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
}

function calendarDayValue(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

export function startOfLocalDay(date: Date, offsetMinutes?: number): Date {
  if (offsetMinutes !== undefined) {
    return new Date(offsetDayValue(date, offsetMinutes) - offsetMinutes * MILLISECONDS_PER_MINUTE);
  }
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function endOfLocalDay(date: Date, offsetMinutes?: number): Date {
  if (offsetMinutes !== undefined) {
    return new Date(startOfLocalDay(date, offsetMinutes).getTime() + MILLISECONDS_PER_DAY - 1);
  }
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

export function effectiveEventEnd(event: CalendarEvent, offsetMinutes?: number): Date {
  if (!event.end) return event.start;

  const end = event.end;
  const shiftedEnd = offsetMinutes === undefined ? end : offsetDate(end, offsetMinutes);
  const isExactLocalMidnight = offsetMinutes === undefined
    ? shiftedEnd.getHours() === 0 &&
      shiftedEnd.getMinutes() === 0 &&
      shiftedEnd.getSeconds() === 0 &&
      shiftedEnd.getMilliseconds() === 0
    : shiftedEnd.getUTCHours() === 0 &&
      shiftedEnd.getUTCMinutes() === 0 &&
      shiftedEnd.getUTCSeconds() === 0 &&
      shiftedEnd.getUTCMilliseconds() === 0;

  if (isExactLocalMidnight && end.getTime() > event.start.getTime()) {
    return new Date(end.getTime() - 1);
  }

  return end;
}

export function eventOccursOnLocalDay(
  event: CalendarEvent,
  day: Date,
  offsetMinutes?: number,
): boolean {
  const dayStart = offsetMinutes === undefined
    ? startOfLocalDay(day).getTime()
    : calendarDayValue(day) - offsetMinutes * MILLISECONDS_PER_MINUTE;
  const dayEnd = offsetMinutes === undefined
    ? endOfLocalDay(day).getTime()
    : dayStart + MILLISECONDS_PER_DAY - 1;
  return (
    event.start.getTime() <= dayEnd &&
    effectiveEventEnd(event, offsetMinutes).getTime() >= dayStart
  );
}

export function eventDayPosition(
  event: CalendarEvent,
  day: Date,
  offsetMinutes?: number,
): 'single' | 'start' | 'middle' | 'end' {
  const startDay = offsetMinutes === undefined
    ? startOfLocalDay(event.start).getTime()
    : offsetDayValue(event.start, offsetMinutes);
  const end = effectiveEventEnd(event, offsetMinutes);
  const endDay = offsetMinutes === undefined
    ? startOfLocalDay(end).getTime()
    : offsetDayValue(end, offsetMinutes);
  const current = offsetMinutes === undefined
    ? startOfLocalDay(day).getTime()
    : calendarDayValue(day);

  if (startDay === endDay) return 'single';
  if (current === startDay) return 'start';
  if (current === endDay) return 'end';
  return 'middle';
}

export function dateAtUtcOffset(date: Date, offsetMinutes: number): Date {
  const shifted = offsetDate(date, offsetMinutes);
  return new Date(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
}

export function formatAtUtcOffset(
  date: Date,
  locale: string,
  offsetMinutes: number,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(
    offsetDate(date, offsetMinutes),
  );
}

export function getMonthGrid(viewDate: Date): Date[] {
  const first = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());

  const last = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);
  const gridEnd = new Date(last);
  gridEnd.setDate(last.getDate() + (6 - last.getDay()));

  gridStart.setHours(12, 0, 0, 0);
  gridEnd.setHours(12, 0, 0, 0);

  const days: Date[] = [];
  const cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    days.push(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()));
    // Advancing the local calendar date avoids DST-related duplicates or gaps.
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatMonthInput(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function parseMonthInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return new Date(Number(match[1]), month - 1, 1);
}
