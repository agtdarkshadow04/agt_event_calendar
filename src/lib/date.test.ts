import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  effectiveEventEnd,
  dateAtUtcOffset,
  eventDayPosition,
  eventOccursOnLocalDay,
  formatAtUtcOffset,
  getMonthGrid,
} from './date';
import type { CalendarEvent } from '../types';

function event(start: string, end: string | null): CalendarEvent {
  return {
    id: 'ABCD',
    name: 'Multi-day event',
    start: new Date(start),
    end: end ? new Date(end) : null,
    civilization: null,
    type: 'Meeting',
    descriptionUrl: null,
    coverImageUrl: null,
    links: [],
    galaxy: 'Euclid',
    region: 'Region',
    system: 'System',
    planet: null,
    portalCode: '0123ABCD4567',
  };
}

describe('calendar date handling', () => {
  it('shows an event on every local day it spans', () => {
    const item = event(
      new Date(2026, 8, 10, 10).toISOString(),
      new Date(2026, 8, 12, 18).toISOString(),
    );

    assert.equal(eventOccursOnLocalDay(item, new Date('2026-09-10T12:00:00')), true);
    assert.equal(eventOccursOnLocalDay(item, new Date('2026-09-11T12:00:00')), true);
    assert.equal(eventOccursOnLocalDay(item, new Date('2026-09-12T12:00:00')), true);
    assert.equal(eventOccursOnLocalDay(item, new Date('2026-09-13T12:00:00')), false);
    assert.equal(eventDayPosition(item, new Date('2026-09-11T12:00:00')), 'middle');
  });

  it('treats an exact-midnight end as exclusive', () => {
    const localMidnight = new Date(2026, 8, 12, 0, 0, 0, 0);
    const previousMillisecond = new Date(2026, 8, 11, 23, 59, 59, 999);
    const item = event(
      '2026-09-10T10:00:00Z',
      localMidnight.toISOString(),
    );

    assert.equal(
      effectiveEventEnd(item).toISOString(),
      previousMillisecond.toISOString(),
    );
    assert.equal(eventOccursOnLocalDay(item, new Date('2026-09-12T12:00:00')), false);
  });

  it('builds a complete Sunday-through-Saturday month grid', () => {
    const days = getMonthGrid(new Date(2026, 7, 1));

    assert.equal(days[0].getDay(), 0);
    assert.equal(days.at(-1)?.getDay(), 6);
    assert.equal(days.length % 7, 0);
    assert.equal(days.some((day) => day.getMonth() === 7 && day.getDate() === 31), true);
  });

  it('places and formats events in an explicitly selected UTC offset', () => {
    const item = event('2026-09-10T01:30:00Z', null);
    const previousDay = new Date(2026, 8, 9);
    const utcMinusFive = -300;

    assert.equal(eventOccursOnLocalDay(item, previousDay, utcMinusFive), true);
    assert.equal(eventOccursOnLocalDay(item, new Date(2026, 8, 10), utcMinusFive), false);
    assert.equal(dateAtUtcOffset(item.start, utcMinusFive).getDate(), 9);
    assert.equal(
      formatAtUtcOffset(item.start, 'en', utcMinusFive, {
        hour: 'numeric',
        minute: '2-digit',
        hour12: false,
      }),
      '20:30',
    );
  });

  it('treats midnight in the selected UTC offset as exclusive', () => {
    const utcPlusFiveThirty = 330;
    const item = event('2026-09-10T12:00:00Z', '2026-09-11T18:30:00Z');

    assert.equal(
      eventOccursOnLocalDay(item, new Date(2026, 8, 12), utcPlusFiveThirty),
      false,
    );
  });
});
