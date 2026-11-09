import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { attachmentFileName } from './client';
import { formatLogTime, logQuery } from './logs';

describe('log helpers', () => {
  it('formats log times in the chosen UTC offset, with seconds', () => {
    assert.equal(formatLogTime('2030-01-01T23:30:15.123Z', 0), '2030-01-01 23:30:15');
    assert.equal(formatLogTime('2030-01-01T23:30:15.123Z', 120), '2030-01-02 01:30:15');
    assert.equal(formatLogTime('2030-01-01T00:00:00Z', -300), '2029-12-31 19:00:00');
    assert.equal(formatLogTime('not a time', 0), 'not a time');
  });

  it('builds list and export queries, converting from/to to UTC', () => {
    assert.equal(logQuery({}, 0), '');
    assert.equal(logQuery({ level: '', q: '  ' }, 0), '');
    assert.equal(
      logQuery({ level: 'warn', q: 'a&b', from: '2030-01-01T10:00', to: '2030-01-01T11:30' }, 60, { limit: 50, cursor: null }),
      '?level=warn&q=a%26b&from=2030-01-01T09%3A00%3A00Z&to=2030-01-01T10%3A30%3A59.999Z&limit=50',
    );
    assert.equal(logQuery({ from: 'garbage' }, 0, { format: 'csv' }), '?format=csv');
  });

  it('reads the download file name from Content-Disposition', () => {
    assert.equal(attachmentFileName('attachment; filename="agt-event-calendar-audit-log-x.csv"', 'f'), 'agt-event-calendar-audit-log-x.csv');
    assert.equal(attachmentFileName(null, 'fallback.jsonl'), 'fallback.jsonl');
  });
});
