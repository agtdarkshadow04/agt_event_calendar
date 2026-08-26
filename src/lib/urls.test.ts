import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildGlyphToolUrl } from './urls';

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
