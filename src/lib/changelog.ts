import Papa from 'papaparse';

export interface ChangeLogEntry {
  date: string;
  changes: string[];
}

export function parseChangeLogCsv(csv: string): ChangeLogEntry[] {
  const parsed = Papa.parse<string[]>(csv, { skipEmptyLines: false });
  const quoteError = parsed.errors.find((error) => error.type === 'Quotes');
  if (quoteError) throw new Error(quoteError.message);

  const entries: ChangeLogEntry[] = [];
  let currentEntry: ChangeLogEntry | null = null;

  for (const row of parsed.data.slice(1)) {
    const date = String(row[0] ?? '').replace(/^\uFEFF/, '').trim();
    const change = String(row[1] ?? '').trim();
    if (!date && !change) continue;

    if (date) {
      currentEntry = { date, changes: [] };
      entries.push(currentEntry);
    }
    if (change && currentEntry) currentEntry.changes.push(change);
  }

  return entries;
}
