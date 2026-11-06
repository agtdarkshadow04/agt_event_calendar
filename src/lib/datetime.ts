/**
 * Conversions between `<input type="datetime-local">` values, interpreted in
 * the viewer's chosen UTC offset, and UTC ISO 8601 timestamps.
 */
const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function localInputToUtcIso(value: string, offsetMinutes: number): string | null {
  const match = LOCAL_INPUT.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const utc = Date.UTC(year, month - 1, day, hour, minute) - offsetMinutes * 60_000;
  const date = new Date(utc);
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return Number.isNaN(date.getTime()) ? null : date.toISOString().replace('.000Z', 'Z');
}

export function utcIsoToLocalInput(value: string | null, offsetMinutes: number): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 16);
}
