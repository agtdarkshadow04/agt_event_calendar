import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filterEvents } from './filter';
import type { CalendarEvent, EventFilters } from '../types';

const baseFilters: EventFilters = {
  search: '',
  type: '',
  civilization: '',
  galaxy: '',
  dateContext: 'all',
};

const events: CalendarEvent[] = [
  {
    id: 'A1B2',
    name: 'Hyades Trade Meet',
    start: new Date('2026-09-05T12:00:00Z'),
    end: null,
    civilization: 'Hyades Travellers Foundation',
    type: 'Trade',
    legacyId: null,
    description: null,
    coverImageUrl: null,
    links: [],
    galaxy: 'Hyades',
    region: 'Core',
    system: 'Atlas Station',
    planet: null,
    portalCode: '0123ABCD4567',
  },
  {
    id: 'C3D4',
    name: 'Euclid Rally',
    start: new Date('2026-10-15T18:00:00Z'),
    end: null,
    civilization: 'Alliance of Galactic Travellers',
    type: 'Race',
    legacyId: null,
    description: null,
    coverImageUrl: null,
    links: [],
    galaxy: 'Euclid',
    region: 'Pilgrim Star',
    system: 'New Athena',
    planet: 'Nexus Point',
    portalCode: '89ABCDEF0123',
  },
];

describe('filterEvents', () => {
  it('searches across names, IDs, locations, and portal codes', () => {
    assert.equal(filterEvents(events, { ...baseFilters, search: 'atlas' }).length, 1);
    assert.equal(
      filterEvents(events, { ...baseFilters, search: 'C3D4' })[0].name,
      'Euclid Rally',
    );
    assert.equal(
      filterEvents(events, { ...baseFilters, search: '89abcdef0123' }).length,
      1,
    );
  });

  it('combines categorical filters', () => {
    const result = filterEvents(events, {
      ...baseFilters,
      type: 'Trade',
      civilization: 'Hyades Travellers Foundation',
      galaxy: 'Hyades',
    });

    assert.deepEqual(result.map((event) => event.id), ['A1B2']);
  });

  it('supports the next-30-days date context', () => {
    const result = filterEvents(
      events,
      { ...baseFilters, dateContext: 'next30' },
      new Date('2026-09-20T09:00:00Z'),
    );

    assert.deepEqual(result.map((event) => event.id), ['C3D4']);
  });

  it('uses the selected UTC offset for local-day filters', () => {
    const boundaryEvent = {
      ...events[0],
      start: new Date('2026-09-20T01:00:00Z'),
    };
    const now = new Date('2026-09-20T12:00:00Z');
    const upcoming = { ...baseFilters, dateContext: 'upcoming' } as const;

    assert.equal(filterEvents([boundaryEvent], upcoming, now, -300).length, 0);
    assert.equal(filterEvents([boundaryEvent], upcoming, now, 60).length, 1);
  });
});
