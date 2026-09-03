import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseChangeLogCsv } from './changelog';

describe('parseChangeLogCsv', () => {
  it('ignores headers and groups continuation rows under the most recent date', () => {
    const csv = [
      '\uFEFFDate,Changes',
      '2026-09-03,"Added the change log"',
      ',"Handled commas, safely"',
      '2026-08-30,Improved calendar navigation',
      ',Fixed focus handling',
    ].join('\n');

    assert.deepEqual(parseChangeLogCsv(csv), [
      {
        date: '2026-09-03',
        changes: ['Added the change log', 'Handled commas, safely'],
      },
      {
        date: '2026-08-30',
        changes: ['Improved calendar navigation', 'Fixed focus handling'],
      },
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
