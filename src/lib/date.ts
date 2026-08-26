import type { CalendarEvent } from '../types';

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function endOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

export function effectiveEventEnd(event: CalendarEvent): Date {
  if (!event.end) return event.start;

  const end = event.end;
  const isExactLocalMidnight =
    end.getHours() === 0 &&
    end.getMinutes() === 0 &&
    end.getSeconds() === 0 &&
    end.getMilliseconds() === 0;

  if (isExactLocalMidnight && end.getTime() > event.start.getTime()) {
    return new Date(end.getTime() - 1);
  }

  return end;
}

export function eventOccursOnLocalDay(
  event: CalendarEvent,
  day: Date,
): boolean {
  const dayStart = startOfLocalDay(day).getTime();
  const dayEnd = endOfLocalDay(day).getTime();
  return (
    event.start.getTime() <= dayEnd &&
    effectiveEventEnd(event).getTime() >= dayStart
  );
}

export function eventDayPosition(
  event: CalendarEvent,
  day: Date,
): 'single' | 'start' | 'middle' | 'end' {
  const startDay = startOfLocalDay(event.start).getTime();
  const endDay = startOfLocalDay(effectiveEventEnd(event)).getTime();
  const current = startOfLocalDay(day).getTime();

  if (startDay === endDay) return 'single';
  if (current === startDay) return 'start';
  if (current === endDay) return 'end';
  return 'middle';
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
