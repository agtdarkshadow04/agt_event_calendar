import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildGlyphToolUrl, withEventId } from './urls';

describe('buildGlyphToolUrl', () => {
  it('builds the expected Glyph Tool URL', () => {
    assert.equal(
      buildGlyphToolUrl('Hyades', '89ABCDEF0123'),
      'https://glyph.nms-agt.com/?embed=false&galaxy=Hyades&glyphs=89ABCDEF0123',
    );
  });

  it('encodes spaces and reserved characters in query values', () => {
    assert.equal(
      buildGlyphToolUrl('Hilbert Dimension & /?', '#AB C'),
      'https://glyph.nms-agt.com/?embed=false&galaxy=Hilbert+Dimension+%26+%2F%3F&glyphs=%23AB+C',
    );
  });
});

describe('withEventId', () => {
  it('adds an encoded event ID while preserving other URL state', () => {
    assert.equal(
      withEventId('https://calendar.example/?view=month#events', 'A1 B2'),
      'https://calendar.example/?view=month&event_id=A1+B2#events',
    );
  });

  it('replaces an existing event ID', () => {
    assert.equal(
      withEventId('https://calendar.example/?event_id=OLD&view=month', 'C3D4'),
      'https://calendar.example/?event_id=C3D4&view=month',
    );
  });

  it('removes the event ID while preserving other URL state', () => {
    assert.equal(
      withEventId('https://calendar.example/?event_id=A1B2&view=month#events', null),
      'https://calendar.example/?view=month#events',
    );
  });
});
