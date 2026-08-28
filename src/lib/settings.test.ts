import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createDefaultSettings,
  parseSettingsJson,
  parseUtcOffset,
  TIME_ZONE_OPTIONS,
} from './settings';

describe('calendar settings', () => {
  it('uses the browser offset and requested defaults', () => {
    const now = new Date('2026-08-28T12:00:00-05:00');
    now.getTimezoneOffset = () => 300;

    assert.deepEqual(createDefaultSettings(now), {
      fontScale: '1x',
      locale: 'en',
      timeZone: 'UTC-05:00',
      anthem: 'unmute',
    });
  });

  it('excludes UTC while retaining fractional major offsets', () => {
    assert.equal(TIME_ZONE_OPTIONS.some(({ value }) => value === 'UTC+00:00'), false);
    assert.equal(TIME_ZONE_OPTIONS.some(({ value }) => value === 'UTC+05:45'), true);
    assert.equal(parseUtcOffset('UTC-03:30'), -210);
  });

  it('round-trips valid exported settings', () => {
    const settings = {
      fontScale: '1.5x',
      locale: 'ja',
      timeZone: 'UTC+09:00',
      anthem: 'mute',
    } as const;

    assert.deepEqual(parseSettingsJson(JSON.stringify(settings)), settings);
  });

  it('rejects invalid imported settings instead of partially applying them', () => {
    assert.throws(
      () => parseSettingsJson('{"fontScale":"4x"}'),
      /unsupported font scale/,
    );
    assert.throws(() => parseSettingsJson('[]'), /must contain an object/);
  });
});
