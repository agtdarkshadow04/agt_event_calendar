import Papa from 'papaparse';

export const HOLIDAY_FIELDS = [
  'HOLIDAY_NAME',
  'HOLIDAY_CIV',
  'HOLIDAY_DATE',
  'HOLIDAY_TYPE',
] as const;

type HolidayField = (typeof HOLIDAY_FIELDS)[number];
type HolidayRecord = Record<HolidayField, string>;

export interface NationalHoliday {
  name: string;
  civilization: string;
  date: Date;
  type: string;
}

function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? date
    : null;
}

function normalizeRecord(record: Record<string, unknown>): HolidayRecord {
  return Object.fromEntries(
    HOLIDAY_FIELDS.map((field) => [field, String(record[field] ?? '').trim()]),
  ) as HolidayRecord;
}

export function parseNationalHolidaysCsv(csv: string): NationalHoliday[] {
  const parsed = Papa.parse<Record<string, unknown>>(csv, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.replace(/^\uFEFF/, '').trim(),
  });

  const parserError = parsed.errors[0];
  if (parserError) throw new Error(parserError.message);

  const presentFields = new Set(parsed.meta.fields ?? []);
  const missingHeaders = HOLIDAY_FIELDS.filter(
    (field) => !presentFields.has(field),
  );
  if (missingHeaders.length > 0) {
    throw new Error(`Missing required CSV headers: ${missingHeaders.join(', ')}`);
  }

  const holidays = parsed.data.map((rawRecord, index) => {
    const row = index + 2;
    const record = normalizeRecord(rawRecord);
    const missingFields = HOLIDAY_FIELDS.filter((field) => !record[field]);
    if (missingFields.length > 0) {
      throw new Error(`Row ${row}: ${missingFields.join(', ')} is required`);
    }

    const date = parseDate(record.HOLIDAY_DATE);
    if (!date) {
      throw new Error(`Row ${row}: HOLIDAY_DATE must use a valid YYYY-MM-DD date`);
    }

    return {
      name: record.HOLIDAY_NAME,
      civilization: record.HOLIDAY_CIV,
      date,
      type: record.HOLIDAY_TYPE,
    };
  });

  holidays.sort(
    (a, b) =>
      a.date.getUTCMonth() - b.date.getUTCMonth() ||
      a.date.getUTCDate() - b.date.getUTCDate(),
  );
  return holidays;
}
