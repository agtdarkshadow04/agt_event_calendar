import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCsvTable } from './csv';
import { HOLIDAY_FIELDS, parseLegacyHolidays, sortHolidays } from './holidays';

const header = HOLIDAY_FIELDS.join(',');

describe('parseLegacyHolidays', () => {
  it('parses required fields', () => {
    const csv = [
      `﻿${header}`,
      'Founding Day,AGT,2018-12-05,Anniversary',
      'Unity Day,"Travellers, United",1999-01-20,Cultural',
    ].join('\r\n');
    const { holidays, errors } = parseLegacyHolidays(parseCsvTable(csv));
    assert.deepEqual(errors, []);
    assert.deepEqual(holidays[1], {
      row: 3,
      input: { name: 'Unity Day', civilization: 'Travellers, United', date: '1999-01-20', type: 'Cultural' },
    });
  });

  it('reports missing values and invalid calendar dates per row', () => {
    const csv = [
      header,
      'Founding Day,,2018-12-05,Anniversary',
      'Leap Day,AGT,2025-02-29,Anniversary',
      'Good Day,AGT,2024-02-29,Anniversary',
    ].join('\n');
    const { holidays, errors } = parseLegacyHolidays(parseCsvTable(csv));
    assert.equal(holidays.length, 1);
    assert.deepEqual(errors.map((error) => error.row), [2, 3]);
    assert.match(errors[0].messages[0], /HOLIDAY_CIV is required/);
    assert.match(errors[1].messages[0], /YYYY-MM-DD/);
  });
});

describe('sortHolidays', () => {
  it('orders holidays by month and day', () => {
    const sorted = sortHolidays([
      { date: '2018-12-05' }, { date: '2024-01-04' }, { date: '1999-01-20' }, { date: '1987-06-12' },
    ]);
    assert.deepEqual(sorted.map((holiday) => holiday.date), ['2024-01-04', '1999-01-20', '1987-06-12', '2018-12-05']);
  });
});
