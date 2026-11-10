import { Fragment, useState } from 'react';
import type { FormEvent } from 'react';
import { apiRequest } from '../lib/client';
import { errorMessage, useAdmin } from './context';
import type { AdminTranslations } from './i18n';
import {
  DetailsJson, DetailsToggle, FilterField, LogExportButtons, LogPager, LogPill, LogTime, TimesShownIn, useLogPage,
} from './LogShared';
import type { LogTone } from './LogShared';

type Level = 'info' | 'warn' | 'error' | 'fatal';

interface ServerLogEntry {
  id: string;
  at: string;
  level: Level;
  source: string;
  message: string;
  requestId: string | null;
  details: Record<string, unknown>;
}

const LEVELS: Level[] = ['info', 'warn', 'error', 'fatal'];
/** Stable subsystem names written by the server (AGT web app spec LOG-7). */
const SOURCES = ['startup', 'shutdown', 'config', 'migrations', 'retention', 'backup', 'http', 'server'];
const ENDPOINT = '/api/admin/logs/server';
const EMPTY_FILTERS = { level: '', source: '', from: '', to: '', q: '' };

export function levelLabel(t: AdminTranslations, level: Level): string {
  return { info: t.levelInfo, warn: t.levelWarn, error: t.levelError, fatal: t.levelFatal }[level];
}

const levelTone = (level: Level): LogTone => (level === 'error' || level === 'fatal' ? 'danger' : level === 'warn' ? 'warning' : 'neutral');

/** Server log: events the server recorded by itself. The admin can filter, export and clear it. */
export function ServerLogPanel({ onCleared }: { onCleared: () => void }) {
  const { t } = useAdmin();
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [reloadKey, setReloadKey] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ error: boolean; text: string }>({ error: false, text: '' });
  const { page, error, loading, hasNewer, newer, older } = useLogPage<ServerLogEntry>(ENDPOINT, filters, reloadKey);

  const apply = (event: FormEvent) => {
    event.preventDefault();
    setFilters(draft);
  };
  const reset = () => {
    setDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
  };
  const clear = async () => {
    if (!window.confirm(t.confirmClearLog)) return;
    try {
      await apiRequest(ENDPOINT, { method: 'DELETE' });
      setNotice({ error: false, text: t.logCleared });
      setReloadKey((key) => key + 1);
      onCleared();
    } catch (failure) {
      setNotice({ error: true, text: errorMessage(failure) });
    }
  };
  const set = (key: keyof typeof EMPTY_FILTERS, value: string) => setDraft({ ...draft, [key]: value });

  return (
    <section className="admin-panel" aria-labelledby="server-log-title">
      <h2 id="server-log-title">{t.tabServerLog}</h2>
      <p>{t.serverLogIntro}</p>
      <form className="admin-toolbar" onSubmit={apply}>
        <FilterField label={t.logMinLevel}>
          <select value={draft.level} onChange={(change) => set('level', change.target.value)}>
            <option value="">{t.allValues}</option>
            {LEVELS.map((level) => <option key={level} value={level}>{levelLabel(t, level)}</option>)}
          </select>
        </FilterField>
        <FilterField label={t.logSource}>
          <select value={draft.source} onChange={(change) => set('source', change.target.value)}>
            <option value="">{t.allValues}</option>
            {SOURCES.map((source) => <option key={source} value={source}>{source}</option>)}
          </select>
        </FilterField>
        <FilterField label={t.logFrom}>
          <input type="datetime-local" value={draft.from} onChange={(change) => set('from', change.target.value)} />
        </FilterField>
        <FilterField label={t.logTo}>
          <input type="datetime-local" value={draft.to} onChange={(change) => set('to', change.target.value)} />
        </FilterField>
        <FilterField label={t.logSearch}>
          <input type="search" value={draft.q} maxLength={200} onChange={(change) => set('q', change.target.value)} />
        </FilterField>
        <button className="button button-primary" type="submit">{t.applyFilters}</button>
        <button className="button button-secondary" type="button" onClick={reset}>{t.resetFilters}</button>
      </form>
      <div className="admin-toolbar">
        <LogExportButtons endpoint={ENDPOINT} filters={filters} kind="server" />
        <button className="button button-secondary danger" type="button" onClick={() => void clear()}>{t.clearLog}</button>
      </div>
      {notice.text && <p className={notice.error ? 'error-note' : 'success-note'} role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
      {error && <p className="error-note" role="alert">{error}</p>}
      <TimesShownIn />
      {loading && page.items.length === 0 ? <p className="loading-note" role="status">{t.loading}</p> : page.items.length === 0 ? (
        <p>{t.noLogEntries}</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table log-table">
            <thead>
              <tr>
                <th scope="col">{t.logTime}</th>
                <th scope="col">{t.logLevel}</th>
                <th scope="col">{t.logSource}</th>
                <th scope="col">{t.logMessage}</th>
                <th scope="col">{t.logDetails}</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((entry) => {
                const open = expanded === entry.id;
                const detailsId = `server-log-${entry.id}`;
                return (
                  <Fragment key={entry.id}>
                    <tr>
                      <td className="log-time"><LogTime value={entry.at} /></td>
                      <td><LogPill tone={levelTone(entry.level)} label={levelLabel(t, entry.level)} /></td>
                      <td><code>{entry.source}</code></td>
                      <td className="log-message">{entry.message}</td>
                      <td><DetailsToggle open={open} controls={detailsId} onToggle={() => setExpanded(open ? null : entry.id)} /></td>
                    </tr>
                    {open && (
                      <tr id={detailsId} className="log-details-row">
                        <td colSpan={5}>
                          {entry.requestId && <p>{t.logRequestId}: <code>{entry.requestId}</code></p>}
                          <DetailsJson value={entry.details} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <LogPager hasNewer={hasNewer} hasOlder={page.nextCursor !== null} onNewer={newer} onOlder={older} />
    </section>
  );
}
