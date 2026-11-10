/**
 * Helpers for the admin dashboard's Server log and Audit log tabs.
 */
import { localInputToUtcIso } from './datetime';

/** Formats a UTC timestamp in the viewer's chosen UTC offset as `YYYY-MM-DD HH:mm:ss`. */
export function formatLogTime(value: string, offsetMinutes: number): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return value;
  return new Date(time + offsetMinutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Builds the query string for a log list or export. Empty values are left
 * out; `from`/`to` are `datetime-local` values in the viewer's offset and are
 * sent as UTC.
 */
export function logQuery(
  filters: Record<string, string>,
  offsetMinutes: number,
  extra: Record<string, string | number | null | undefined> = {},
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (key === 'from' || key === 'to') {
      const utc = localInputToUtcIso(trimmed, offsetMinutes);
      // `to` includes the whole selected minute.
      if (utc) params.set(key, key === 'to' ? new Date(Date.parse(utc) + 59_999).toISOString() : utc);
      continue;
    }
    params.set(key, trimmed);
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value !== null && value !== undefined && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}
