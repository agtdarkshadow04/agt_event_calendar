import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  browserTimeZone,
  createDefaultSettings,
  parseSettingsJson,
  parseUtcOffset,
  resolveTimeZone,
  TIME_ZONE_OPTIONS,
} from './settings';

describe('calendar settings', () => {
  it('uses Auto and the requested defaults', () => {
    assert.deepEqual(createDefaultSettings(), {
      fontScale: '1x',
      locale: 'en',
      timeZone: 'Auto',
      anthem: 'mute',
    });
  });

  it('resolves Auto to the browser offset', () => {
    const now = new Date('2026-08-28T17:00:00Z');
    now.getTimezoneOffset = () => 300;

    assert.equal(browserTimeZone(now), 'UTC-05:00');
    assert.deepEqual(resolveTimeZone('Auto', now), {
      label: 'UTC-05:00',
      offsetMinutes: -300,
    });

    now.getTimezoneOffset = () => 0;
    assert.deepEqual(resolveTimeZone('Auto', now), {
      label: 'UTC+00:00',
      offsetMinutes: 0,
    });
  });

  it('includes Auto, excludes manual UTC, and retains fractional major offsets', () => {
    assert.equal(TIME_ZONE_OPTIONS[0].value, 'Auto');
    assert.equal(TIME_ZONE_OPTIONS.some(({ value }) => value === 'UTC+00:00'), false);
    assert.equal(TIME_ZONE_OPTIONS.some(({ value }) => value === 'UTC+05:45'), true);
    assert.equal(parseUtcOffset('UTC-03:30'), -210);
  });

  it('round-trips valid exported settings', () => {
    const settings = {
      fontScale: '1.5x',
      locale: 'ja',
      timeZone: 'Auto',
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

  it('localizes import validation errors', () => {
    assert.throws(
      () => parseSettingsJson('{"fontScale":"4x"}', 'de'),
      /nicht unterstützte Schriftgröße/,
    );
  });
});
