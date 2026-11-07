import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { localInputToUtcIso, utcIsoToLocalInput } from './datetime';

describe('datetime-local conversions', () => {
  it('converts from the chosen offset to UTC and back', () => {
    assert.equal(localInputToUtcIso('2026-09-01T20:30', 120), '2026-09-01T18:30:00Z');
    assert.equal(localInputToUtcIso('2026-01-01T01:00', -300), '2026-01-01T06:00:00Z');
    assert.equal(localInputToUtcIso('2026-01-01T00:15', 345), '2025-12-31T18:30:00Z');
    assert.equal(utcIsoToLocalInput('2026-09-01T18:30:00Z', 120), '2026-09-01T20:30');
    assert.equal(utcIsoToLocalInput(null, 0), '');
  });

  it('rejects malformed and impossible values', () => {
    assert.equal(localInputToUtcIso('', 0), null);
    assert.equal(localInputToUtcIso('2026-02-30T10:00', 0), null);
    assert.equal(localInputToUtcIso('2026-09-01 20:30', 0), null);
  });
});
