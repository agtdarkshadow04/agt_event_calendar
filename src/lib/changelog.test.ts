import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseChangeLogCsv } from './changelog';

describe('parseChangeLogCsv', () => {
  it('ignores headers and groups comma-separated changes under the most recent date', () => {
    const csv = [
      '\uFEFFDate,Changes',
      '2026-09-03,"Added the change log, Updated settings"',
      ',"Handled commas, safely"',
      '2026-08-30,Improved calendar navigation',
      ',Fixed focus handling',
    ].join('\n');

    assert.deepEqual(parseChangeLogCsv(csv), [
      {
        date: '2026-09-03',
        changes: ['Added the change log', 'Updated settings', 'Handled commas', 'safely'],
      },
      {
        date: '2026-08-30',
        changes: ['Improved calendar navigation', 'Fixed focus handling'],
      },
    ]);
  });

  it('trims changes and ignores empty comma-separated items', () => {
    const csv = [
      'Date,Changes',
      '2026-09-03," , First change ,, Second change, "',
      '," , Third change, , "',
      '2026-09-02," , , "',
    ].join('\n');

    assert.deepEqual(parseChangeLogCsv(csv), [
      { date: '2026-09-03', changes: ['First change', 'Second change', 'Third change'] },
      { date: '2026-09-02', changes: [] },
    ]);
  });

  it('preserves CSV quoting and splits only the second column', () => {
    const csv = 'Date,Changes,Notes\n"September 3, 2026","Added ""new"" settings,Fixed\ncalendar layout","Ignored, notes"';

    assert.deepEqual(parseChangeLogCsv(csv), [
      { date: 'September 3, 2026', changes: ['Added "new" settings', 'Fixed\ncalendar layout'] },
    ]);
  });

  it('ignores fully blank rows while retaining date rows', () => {
    assert.deepEqual(parseChangeLogCsv('Date,Changes\n2026-09-03,\n,\n2026-09-02,Fixed sync'), [
      { date: '2026-09-03', changes: [] },
      { date: '2026-09-02', changes: ['Fixed sync'] },
    ]);
  });

  it('returns no entries for empty or header-only CSV', () => {
    assert.deepEqual(parseChangeLogCsv(''), []);
    assert.deepEqual(parseChangeLogCsv('Date,Changes'), []);
  });

  it('rejects malformed quoted CSV', () => {
    assert.throws(() => parseChangeLogCsv('Date,Changes\n2026-09-03,"Unclosed change'));
  });
});
