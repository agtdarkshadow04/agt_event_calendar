import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EVENT_FIELDS, parseEventsCsv } from './csv';

const header = EVENT_FIELDS.join(',');

describe('parseEventsCsv', () => {
  it('parses quoted commas and related link lists correctly', () => {
    const csv = `${header}\nAB1F,"Meetup, Expedition",2026-09-01T18:30:00Z,2026-09-02T01:00:00Z,"Alliance of Galactic Travellers",Expedition,,,"https://example.com/one, https://example.com/two",Euclid,Region Alpha,System Prime,Planet One,0123ABCD4567`;

    const result = parseEventsCsv(csv);

    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].name, 'Meetup, Expedition');
    assert.deepEqual(result.events[0].links, [
      'https://example.com/one',
      'https://example.com/two',
    ]);
    assert.equal(result.warnings.length, 0);
  });

  it('skips malformed rows without discarding valid events', () => {
    const csv = [
      header,
      'ZZZZ,Bad ID,2026-09-01T18:30:00Z,,,Meeting,,,,Euclid,Region,System,,0123ABCD4567',
      'C0DE,Valid Event,2026-09-03T18:30:00Z,,AGT,Meeting,,,,Euclid,Region,System,,89ABCDEF0123',
    ].join('\n');

    const result = parseEventsCsv(csv);

    assert.deepEqual(result.events.map((event) => event.id), ['C0DE']);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].row, 2);
    assert.match(result.warnings[0].messages.join(' '), /hexadecimal/i);
  });

  it('keeps a valid row while dropping unsafe external URLs', () => {
    const csv = `${header}\nBEEF,Safe Event,2026-09-01T18:30:00Z,,AGT,Meeting,javascript:alert(1),data:text/html,test,Euclid,Region,System,,0123ABCD4567`;

    const result = parseEventsCsv(csv);

    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].descriptionUrl, null);
    assert.equal(result.events[0].coverImageUrl, null);
    assert.deepEqual(result.events[0].links, []);
    assert.equal(result.warnings[0].messages.length, 3);
  });

  it('requires UTC ISO 8601 timestamps', () => {
    const csv = `${header}\nABCD,Local Timestamp,2026-09-01T18:30:00,,,Meeting,,,,Euclid,Region,System,,0123ABCD4567`;

    const result = parseEventsCsv(csv);

    assert.equal(result.events.length, 0);
    assert.match(result.warnings[0].messages.join(' '), /UTC ISO 8601/i);
  });

  it('skips duplicate event IDs so calendar keys remain unique', () => {
    const csv = [
      header,
      'ABCD,First Event,2026-09-01T18:30:00Z,,AGT,Meeting,,,,Euclid,Region,System,,0123ABCD4567',
      'abcd,Duplicate Event,2026-09-02T18:30:00Z,,AGT,Meeting,,,,Euclid,Region,System,,89ABCDEF0123',
    ].join('\n');

    const result = parseEventsCsv(csv);

    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].name, 'First Event');
    assert.match(result.warnings[0].messages.join(' '), /duplicate EVENT_ID/i);
    assert.equal(result.warnings[0].skipped, true);
  });

  it('localizes validation warnings for the selected locale', () => {
    const csv = `${header}\nZZZZ,Bad ID,2026-09-01T18:30:00Z,,,Meeting,,,,Euclid,Region,System,,0123ABCD4567`;

    const result = parseEventsCsv(csv, 'fr');

    assert.match(result.warnings[0].messages.join(' '), /hexadécimaux/i);
  });
});
