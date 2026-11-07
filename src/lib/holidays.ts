import { validateHolidayInput } from './validation';
import type { HolidayInput } from './validation';
import type { CsvTable, LegacyRowError } from './csv';

export const HOLIDAY_FIELDS = [
  'HOLIDAY_NAME',
  'HOLIDAY_CIV',
  'HOLIDAY_DATE',
  'HOLIDAY_TYPE',
] as const;

export interface NationalHoliday {
  id: string;
  name: string;
  civilization: string;
  /** First occurrence, `YYYY-MM-DD`. */
  date: string;
  type: string;
}

/** Orders holidays by month and day, ignoring the year of first occurrence. */
export function sortHolidays<T extends { date: string }>(holidays: T[]): T[] {
  return [...holidays].sort((a, b) => a.date.slice(5).localeCompare(b.date.slice(5)));
}

/** Validates the rows of a legacy `publishedHolidayDB` CSV export. */
export function parseLegacyHolidays(table: CsvTable): {
  holidays: { row: number; input: HolidayInput }[];
  errors: LegacyRowError[];
} {
  const holidays: { row: number; input: HolidayInput }[] = [];
  const errors: LegacyRowError[] = table.errors.map((error) => ({
    row: error.row,
    messages: [`CSV parser: ${error.message}`],
  }));
  for (const { row, record } of table.rows) {
    const result = validateHolidayInput({
      name: record.HOLIDAY_NAME,
      civilization: record.HOLIDAY_CIV,
      date: record.HOLIDAY_DATE,
      type: record.HOLIDAY_TYPE,
    });
    if (result.ok) holidays.push({ row, input: result.value });
    else errors.push({ row, messages: result.errors.map((error) => error.message) });
  }
  return { holidays, errors };
}
