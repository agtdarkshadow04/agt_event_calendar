import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EVENT_FIELDS, fileNameFromUri, parseCsvTable, parseLegacyEvents } from './csv';

const header = EVENT_FIELDS.join(',');
const FILES = 'https://raw.githubusercontent.com/Folfchie/agt_event_calendar_files/main';

describe('parseCsvTable', () => {
  it('strips a BOM, trims headers, accepts CRLF and a missing final newline', () => {
    const table = parseCsvTable('﻿ A , B \r\n1,2\r\n\r\n,\r\n3,"4, 5"');
    assert.deepEqual(table.headers, ['A', 'B']);
    assert.deepEqual(table.rows, [
      { row: 2, record: { A: '1', B: '2' } },
      { row: 5, record: { A: '3', B: '4, 5' } },
    ]);
    assert.deepEqual(table.errors, []);
  });
});

describe('fileNameFromUri', () => {
  it('takes the file name from the URI path', () => {
    assert.equal(fileNameFromUri(`${FILES}/markdown/0000.md`), '0000.md');
    assert.equal(fileNameFromUri(`${FILES}/covers/My%20Cover.jpg?x=1`), 'My Cover.jpg');
    assert.equal(fileNameFromUri('javascript:alert(1)'), null);
    assert.equal(fileNameFromUri('https://example.com/'), null);
    assert.equal(fileNameFromUri('https://example.com/a/%2e%2e'), null);
  });
});

describe('parseLegacyEvents', () => {
  it('parses quoted commas, ", " link lists, placeholders and file names', () => {
    const csv = `${header}\r\nab1f,"Meetup, Expedition",2026-09-01T18:30:00Z,2026-09-02T01:00:00Z,AGT,Expedition,${FILES}/markdown/AB1F.md,${FILES}/covers/AB1F.jpg,"https://example.com/one, https://example.com/two",Euclid,TBA,TBA,TBA,000000000000`;
    const { events, errors } = parseLegacyEvents(parseCsvTable(csv));
    assert.deepEqual(errors, []);
    assert.equal(events.length, 1);
    const [event] = events;
    assert.equal(event.legacyId, 'AB1F');
    assert.equal(event.row, 2);
    assert.equal(event.input.name, 'Meetup, Expedition');
    assert.equal(event.input.region, 'TBA');
    assert.equal(event.input.portalCode, '000000000000');
    assert.equal(event.input.start, '2026-09-01T18:30:00.000Z');
    assert.deepEqual(event.input.links, ['https://example.com/one', 'https://example.com/two']);
    assert.equal(event.markdownFile, 'AB1F.md');
    assert.equal(event.coverFile, 'AB1F.jpg');
  });

  it('reports invalid rows with source row numbers and keeps valid ones', () => {
    const csv = [
      header,
      'ZZZZ,Bad ID,2026-09-01T18:30:00Z,,,Meeting,,,,Euclid,Region,System,,0123ABCD4567',
      'C0DE,Valid Event,2026-09-03T18:30:00Z,,AGT,Meeting,,,,Euclid,Region,System,,89ABCDEF0123',
      'c0de,Duplicate,2026-09-03T18:30:00Z,,AGT,Meeting,,,,Euclid,Region,System,,89ABCDEF0123',
      'ABCD,Local Timestamp,2026-09-01T18:30:00,,,Meeting,,,,Euclid,Region,System,,0123ABCD4567',
    ].join('\n');
    const { events, errors } = parseLegacyEvents(parseCsvTable(csv));
    assert.deepEqual(events.map((event) => event.legacyId), ['C0DE']);
    assert.deepEqual(errors.map((error) => error.row), [2, 4, 5]);
    assert.match(errors[0].messages.join(' '), /hexadecimal/i);
    assert.match(errors[1].messages.join(' '), /duplicate EVENT_ID/i);
    assert.match(errors[2].messages.join(' '), /UTC ISO 8601/i);
  });

  it('keeps a valid row while dropping unsafe URLs with warnings', () => {
    const csv = `${header}\nBEEF,Safe Event,2026-09-01T18:30:00Z,,AGT,Meeting,javascript:alert(1),data:text/html,"test, ftp://x",Euclid,Region,System,,0123ABCD4567`;
    const { events } = parseLegacyEvents(parseCsvTable(csv));
    assert.equal(events.length, 1);
    assert.equal(events[0].markdownFile, null);
    assert.equal(events[0].coverFile, null);
    assert.deepEqual(events[0].input.links, []);
    assert.equal(events[0].warnings.length, 4);
  });
});
