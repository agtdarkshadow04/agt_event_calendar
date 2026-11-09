import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getTranslations } from '../translations';
import {
  isPortalCode,
  isUuidV4,
  normalizeEventId,
  portalGlyphCode,
  splitChanges,
  validateAgtUsername,
  validateChangeLogInput,
  validateEventInput,
  validateHolidayInput,
} from './validation';

const valid = {
  name: ' Summit ',
  start: '2026-09-01T18:30:00Z',
  end: '2026-09-02T18:30:00+00:00',
  type: 'Meetup',
  galaxy: 'Euclid',
  region: 'Region',
  system: 'System',
  portalCode: '0123abcd4567',
  links: 'https://example.com/a\nhttps://example.com/b, javascript:alert(1)',
  description: '<script>alert(1)</script>\r\n# Title  \n',
};

describe('isUuidV4 / normalizeEventId', () => {
  it('accepts only RFC 9562 version 4 UUIDs', () => {
    assert.equal(isUuidV4('3f2b8c1e-9d4a-4f6b-8a2c-1e5d7f9b0a3c'), true);
    assert.equal(isUuidV4('3f2b8c1e-9d4a-1f6b-8a2c-1e5d7f9b0a3c'), false, 'version 1');
    assert.equal(isUuidV4('3f2b8c1e-9d4a-4f6b-ca2c-1e5d7f9b0a3c'), false, 'variant 110x');
    assert.equal(isUuidV4('abcd'), false);
  });

  it('normalises UUIDs to lowercase and legacy IDs to uppercase', () => {
    assert.equal(normalizeEventId(' 3F2B8C1E-9D4A-4F6B-8A2C-1E5D7F9B0A3C '), '3f2b8c1e-9d4a-4f6b-8a2c-1e5d7f9b0a3c');
    assert.equal(normalizeEventId('ab1f'), 'AB1F');
    assert.equal(normalizeEventId('ab1'), null);
  });
});

describe('validateEventInput', () => {
  it('normalises a valid event and keeps Markdown as written', () => {
    const result = validateEventInput(valid);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.name, 'Summit');
    assert.equal(result.value.start, '2026-09-01T18:30:00.000Z');
    assert.equal(result.value.portalCode, '0123ABCD4567');
    assert.deepEqual(result.value.links, ['https://example.com/a', 'https://example.com/b']);
    assert.equal(result.value.description, '<script>alert(1)</script>\n# Title  \n');
    assert.equal(result.notices.length, 1);
  });

  it('reports every invalid field', () => {
    const result = validateEventInput({
      ...valid,
      name: '',
      start: '2026-09-01T18:30:00',
      portalCode: 'ABC',
      name2: 'ignored',
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(result.errors.map((error) => error.field).sort(), ['name', 'portalCode', 'start']);
  });

  it('rejects an end before the start and over-long values', () => {
    const result = validateEventInput({ ...valid, end: '2026-08-01T00:00:00Z', name: 'x'.repeat(201) });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(result.errors.map((error) => error.field).sort(), ['end', 'name']);
  });

  it('localises messages', () => {
    const result = validateEventInput({ ...valid, portalCode: 'x' }, getTranslations('fr'));
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.errors[0].message, /12/);
  });
});

describe('portal codes as glyphs', () => {
  it('accepts exactly 12 hexadecimal digits, uppercased and trimmed', () => {
    assert.equal(portalGlyphCode(' 0123abcd4567 '), '0123ABCD4567');
    assert.equal(portalGlyphCode('FFFFFFFFFFFF'), 'FFFFFFFFFFFF');
    assert.equal(isPortalCode('000000000000'), true);
  });

  it('rejects placeholders and codes the glyph font cannot draw', () => {
    for (const value of ['TBA', '', '0123ABCD456', '0123ABCD45678', '0123ABCD456G', 'ZZZZZZZZZZZZ', '0123 ABCD 4567']) {
      assert.equal(portalGlyphCode(value), null, value);
      assert.equal(isPortalCode(value), false, value);
    }
  });
});

describe('other validators', () => {
  it('validates AGT usernames', () => {
    assert.deepEqual(validateAgtUsername(' Traveller ').ok, true);
    assert.equal(validateAgtUsername('').ok, false);
    assert.equal(validateAgtUsername('x'.repeat(65)).ok, false);
  });

  it('validates holidays and change-log entries', () => {
    assert.equal(validateHolidayInput({ name: 'A', civilization: 'B', date: '2024-02-29', type: 'C' }).ok, true);
    assert.equal(validateHolidayInput({ name: 'A', civilization: 'B', date: '2025-02-29', type: 'C' }).ok, false);
    assert.equal(validateChangeLogInput({ date: '2026-01-01', changes: 'a, b' }).ok, true);
    assert.equal(validateChangeLogInput({ date: '01/01/2026', changes: 'a' }).ok, false);
    assert.deepEqual(splitChanges('Added X, Fixed Y\nImproved Z,'), ['Added X', 'Fixed Y', 'Improved Z']);
  });
});
