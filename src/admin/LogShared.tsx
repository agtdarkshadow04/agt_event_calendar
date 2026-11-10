import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { apiDownload, apiRequest } from '../lib/client';
import { formatLogTime, logQuery } from '../lib/logs';
import { formatTranslation } from '../translations';
import { downloadBlob, errorMessage, useAdmin } from './context';

/** Shared parts of the Server log and Audit log tabs. */

export interface LogPage<T> {
  items: T[];
  nextCursor: string | null;
}

export const LOG_PAGE_SIZE = 50;

/**
 * Loads one page of a log, newest first. Paging keeps a stack of cursors so
 * "Newer entries" can go back; changing the filters or `reloadKey` starts over.
 */
export function useLogPage<T>(endpoint: string, filters: Record<string, string>, reloadKey: number) {
  const admin = useAdmin();
  const { timeZoneOffset } = admin;
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState<LogPage<T>>({ items: [], nextCursor: null });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const filterKey = JSON.stringify(filters);
  const cursor = cursors[cursors.length - 1];

  useEffect(() => {
    setCursors([null]);
  }, [filterKey, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiRequest<LogPage<T>>(`${endpoint}${logQuery(filters, timeZoneOffset, { limit: LOG_PAGE_SIZE, cursor })}`)
      .then((result) => {
        if (cancelled) return;
        setPage(result);
        setError('');
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(errorMessage(failure, admin));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `filters` is represented by `filterKey`.
  }, [endpoint, filterKey, cursor, timeZoneOffset, reloadKey]);

  return {
    page,
    error,
    loading,
    hasNewer: cursors.length > 1,
    newer: () => setCursors((current) => (current.length > 1 ? current.slice(0, -1) : current)),
    older: () => {
      if (page.nextCursor) setCursors((current) => [...current, page.nextCursor]);
    },
  };
}

export function LogPager({ hasNewer, hasOlder, onNewer, onOlder }: { hasNewer: boolean; hasOlder: boolean; onNewer: () => void; onOlder: () => void }) {
  const { t } = useAdmin();
  if (!hasNewer && !hasOlder) return null;
  return (
    <div className="admin-toolbar">
      <button className="button button-secondary" type="button" disabled={!hasNewer} onClick={onNewer}>{t.newerEntries}</button>
      <button className="button button-secondary" type="button" disabled={!hasOlder} onClick={onOlder}>{t.olderEntries}</button>
    </div>
  );
}

/** Downloads the current filter as JSON Lines or CSV, generated and streamed by the server. */
export function LogExportButtons({ endpoint, filters, kind }: { endpoint: string; filters: Record<string, string>; kind: 'server' | 'audit' }) {
  const admin = useAdmin();
  const { t, timeZoneOffset } = admin;
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const download = async (format: 'jsonl' | 'csv') => {
    setBusy(true);
    try {
      const { blob, fileName } = await apiDownload(
        `${endpoint}/export${logQuery(filters, timeZoneOffset, { format })}`,
        `agt-event-calendar-${kind}-log.${format}`,
      );
      downloadBlob(blob, fileName);
      setMessage('');
    } catch (failure) {
      setMessage(errorMessage(failure, admin));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className="button button-secondary" type="button" disabled={busy} onClick={() => void download('jsonl')}>{t.exportJsonl}</button>
      <button className="button button-secondary" type="button" disabled={busy} onClick={() => void download('csv')}>{t.exportCsv}</button>
      {message && <p className="error-note" role="alert">{message}</p>}
    </>
  );
}

export type LogTone = 'danger' | 'warning' | 'ok' | 'neutral';

/** Levels and outcomes are shown with colour and text, never colour alone. */
export function LogPill({ tone, label }: { tone: LogTone; label: string }) {
  return <span className={`status-pill log-${tone}`}>{label}</span>;
}

export function LogTime({ value }: { value: string }) {
  const { timeZoneOffset } = useAdmin();
  return <time dateTime={value}>{formatLogTime(value, timeZoneOffset)}</time>;
}

export function TimesShownIn() {
  const { t, timeZone } = useAdmin();
  return <p className="field-help">{formatTranslation(t.timesShownIn, { zone: timeZone })}</p>;
}

/** A labelled filter field. */
export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

/** Toggle button for an entry's details row. */
export function DetailsToggle({ open, onToggle, controls }: { open: boolean; onToggle: () => void; controls: string }) {
  const { t } = useAdmin();
  return (
    <button className="button button-secondary" type="button" aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      {open ? t.hideDetails : t.showDetails}
    </button>
  );
}

export function DetailsJson({ value }: { value: unknown }) {
  return <pre className="admin-pre">{JSON.stringify(value, null, 2)}</pre>;
}
