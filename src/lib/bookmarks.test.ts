import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import {
  BOOKMARKS_STORAGE_KEY,
  loadBookmarks,
  parseBookmarksCsv,
  resolveBookmarks,
  saveBookmarks,
  serializeBookmarks,
} from './bookmarks';
import { filterEvents } from './filter';
import { parseEventsCsv } from './csv';

describe('event bookmarks', () => {
  it('normalizes quoted IDs, whitespace, BOM, line endings, and duplicates', () => {
    assert.deepEqual(
      parseBookmarksCsv('\uFEFFEVENT_ID\r\n"abcd"\r\n AB12 \r\nABCD\r\n\r\n0000'),
      ['ABCD', 'AB12', '0000'],
    );
  });

  it('round-trips exports, including an empty bookmark table', () => {
    for (const ids of [[], ['ABCD', '0000', 'FFFF']]) {
      assert.deepEqual(parseBookmarksCsv(serializeBookmarks(ids)), ids);
    }
    assert.equal(serializeBookmarks([]), 'EVENT_ID\r\n');
  });

  it('rejects malformed imports completely, including invalid IDs after valid rows', () => {
    for (const csv of [
      '', 'ABCD', 'ID\nABCD', 'EVENT_ID,NAME\nABCD,Test',
      'EVENT_ID\nABCD,1234', 'EVENT_ID\nABCD\nXYZ1',
      'EVENT_ID\nABCD\n12345', 'EVENT_ID\nABCD\n123',
      'EVENT_ID\n"ABCD', 'EVENT_ID\n=1+1',
    ]) {
      assert.throws(() => parseBookmarksCsv(csv), /EVENT_ID/);
    }
  });

  it('localizes invalid CSV feedback', () => {
    assert.throws(() => parseBookmarksCsv('ID\nABCD', 'de'), /Lesezeichen-CSV/);
  });

  it('stores only IDs as CSV, reloads them, and persists clearing', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: storage },
    });
    try {
      assert.deepEqual(loadBookmarks(), []);
      saveBookmarks(['ABCD', '0001']);
      assert.equal(values.get(BOOKMARKS_STORAGE_KEY), 'EVENT_ID\r\nABCD\r\n0001');
      assert.deepEqual(loadBookmarks(), ['ABCD', '0001']);
      saveBookmarks(['0001']);
      assert.deepEqual(loadBookmarks(), ['0001']);
      saveBookmarks([]);
      assert.deepEqual(loadBookmarks(), []);

      values.set(BOOKMARKS_STORAGE_KEY, 'broken CSV');
      assert.throws(loadBookmarks, /EVENT_ID/);
      assert.equal(values.get(BOOKMARKS_STORAGE_KEY), 'broken CSV');

      mock.method(storage, 'getItem', () => { throw new Error('Storage blocked'); });
      mock.method(storage, 'setItem', () => { throw new Error('Quota exceeded'); });
      assert.throws(loadBookmarks, /Storage blocked/);
      assert.throws(() => saveBookmarks(['ABCD']), /Quota exceeded/);
    } finally {
      mock.restoreAll();
      Reflect.deleteProperty(globalThis, 'window');
    }
  });

  it('resolves saved events and missing IDs independently of search filters', () => {
    const { events } = parseEventsCsv([
      'EVENT_ID,EVENT_NAME,EVENT_DATETIME_START,EVENT_TYPE,EVENT_GALAXY_NAME,EVENT_REGION_NAME,EVENT_SYSTEM_NAME,EVENT_PORTAL_CODE',
      'ABCD,Old gathering,2020-01-01T00:00:00Z,Meetup,Euclid,Region,System,0123456789AB',
      '0001,Future gathering,2030-01-01T00:00:00Z,Race,Hyades,Region,System,0123456789AB',
      '0002,Unsaved gathering,2031-01-01T00:00:00Z,Race,Hyades,Region,System,0123456789AB',
    ].join('\n'));
    const resolved = resolveBookmarks(events, ['0001', 'FFFF', 'ABCD']);
    assert.deepEqual(resolved.events.map(({ id }) => id), ['ABCD', '0001']);
    assert.deepEqual(resolved.missingIds, ['FFFF']);
    const filters = { search: '', type: '', civilization: '', galaxy: '', dateContext: 'all' } as const;
    for (const search of ['0001', ' HYADES ', 'race', 'future']) {
      assert.deepEqual(
        filterEvents(resolved.events, { ...filters, search }).map(({ id }) => id),
        ['0001'],
      );
    }
    assert.deepEqual(filterEvents(resolved.events, filters), resolved.events);
    assert.deepEqual(resolveBookmarks([], ['ABCD']).missingIds, ['ABCD']);
    assert.deepEqual(resolveBookmarks(events, []), { events: [], missingIds: [] });
  });
});
