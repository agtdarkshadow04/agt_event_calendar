import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HOLIDAY_FIELDS, parseNationalHolidaysCsv } from './holidays';

const header = HOLIDAY_FIELDS.join(',');

describe('parseNationalHolidaysCsv', () => {
  it('parses required fields and orders holidays by month and day', () => {
    const csv = [
      `\uFEFF${header}`,
      'Founding Day,AGT,2018-12-05,Anniversary',
      'First Contact,AGT,2024-01-04,Commemoration',
      'Unity Day,"Travellers, United",1999-01-20,Cultural',
      'Exploration Day,AGT,1987-06-12,Observance',
    ].join('\n');

    const holidays = parseNationalHolidaysCsv(csv);

    assert.deepEqual(holidays.map((holiday) => holiday.name), [
      'First Contact',
      'Unity Day',
      'Exploration Day',
      'Founding Day',
    ]);
    assert.equal(holidays[1].civilization, 'Travellers, United');
    assert.equal(holidays[1].date.toISOString(), '1999-01-20T00:00:00.000Z');
    assert.equal(holidays[1].type, 'Cultural');
  });

  it('returns no holidays for a header-only CSV', () => {
    assert.deepEqual(parseNationalHolidaysCsv(header), []);
  });

  it('rejects missing headers and required values', () => {
    assert.throws(
      () => parseNationalHolidaysCsv(
        'HOLIDAY_NAME,HOLIDAY_DATE\nFounding Day,2018-12-05',
      ),
      /HOLIDAY_CIV, HOLIDAY_TYPE/,
    );
    assert.throws(
      () => parseNationalHolidaysCsv(
        `${header}\nFounding Day,,2018-12-05,Anniversary`,
      ),
      /Row 2: HOLIDAY_CIV is required/,
    );
  });

  it('rejects invalid calendar dates and malformed CSV', () => {
    assert.throws(
      () => parseNationalHolidaysCsv(
        `${header}\nFounding Day,AGT,2025-02-29,Anniversary`,
      ),
      /HOLIDAY_DATE must use a valid YYYY-MM-DD date/,
    );
    assert.throws(
      () => parseNationalHolidaysCsv(
        `${header}\n"Founding Day,AGT,2018-12-05,Anniversary`,
      ),
    );
  });
});
