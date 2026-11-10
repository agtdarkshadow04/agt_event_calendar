import { Fragment, useState } from 'react';
import type { FormEvent } from 'react';
import { formatLogTime } from '../lib/logs';
import { formatTranslation } from '../translations';
import { useAdmin } from './context';
import type { AdminTranslations } from './i18n';
import {
  DetailsJson, DetailsToggle, FilterField, LogExportButtons, LogPager, LogPill, LogTime, TimesShownIn, useLogPage,
} from './LogShared';
import type { LogTone } from './LogShared';

type Outcome = 'success' | 'denied' | 'rate_limited' | 'failure';

interface AuditEntry {
  id: string;
  at: string;
  lastAt: string;
  count: number;
  actorType: 'admin' | 'anonymous';
  actor: string | null;
  ipHash: string | null;
  client: 'web' | 'api';
  action: string;
  method: string;
  route: string;
  targetType: string | null;
  targetId: string | null;
  outcome: Outcome;
  statusCode: number;
  requestId: string | null;
  details: Record<string, unknown>;
}

const OUTCOMES: Outcome[] = ['success', 'denied', 'rate_limited', 'failure'];
const ENDPOINT = '/api/admin/logs/audit';
const EMPTY_FILTERS = { actorType: '', action: '', outcome: '', targetType: '', targetId: '', from: '', to: '', q: '' };

export function outcomeLabel(t: AdminTranslations, outcome: Outcome): string {
  return { success: t.outcomeSuccess, denied: t.outcomeDenied, rate_limited: t.outcomeRateLimited, failure: t.outcomeFailure }[outcome];
}

const outcomeTone = (outcome: Outcome): LogTone =>
  outcome === 'failure' ? 'danger' : outcome === 'success' ? 'ok' : 'warning';

/**
 * Audit log: what users did. Read-only: there is deliberately no control that
 * edits or clears it (AGT web app spec LOG-20).
 */
export function AuditLogPanel() {
  const { t, timeZoneOffset } = useAdmin();
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { page, error, loading, hasNewer, newer, older } = useLogPage<AuditEntry>(ENDPOINT, filters, 0);

  const apply = (event: FormEvent) => {
    event.preventDefault();
    setFilters(draft);
  };
  const reset = () => {
    setDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
  };
  const set = (key: keyof typeof EMPTY_FILTERS, value: string) => setDraft({ ...draft, [key]: value });
  const text = (key: 'action' | 'targetType' | 'targetId' | 'q', label: string, maxLength: number) => (
    <FilterField label={label}>
      <input type={key === 'q' ? 'search' : 'text'} value={draft[key]} maxLength={maxLength} spellCheck={false}
        onChange={(change) => set(key, change.target.value)} />
    </FilterField>
  );

  return (
    <section className="admin-panel" aria-labelledby="audit-log-title">
      <h2 id="audit-log-title">{t.tabAuditLog}</h2>
      <p>{t.auditLogIntro}</p>
      <form className="admin-toolbar" onSubmit={apply}>
        <FilterField label={t.logActorType}>
          <select value={draft.actorType} onChange={(change) => set('actorType', change.target.value)}>
            <option value="">{t.allValues}</option>
            <option value="admin">{t.actorAdmin}</option>
            <option value="anonymous">{t.actorAnonymous}</option>
          </select>
        </FilterField>
        {text('action', t.logAction, 100)}
        <FilterField label={t.logOutcome}>
          <select value={draft.outcome} onChange={(change) => set('outcome', change.target.value)}>
            <option value="">{t.allValues}</option>
            {OUTCOMES.map((outcome) => <option key={outcome} value={outcome}>{outcomeLabel(t, outcome)}</option>)}
          </select>
        </FilterField>
        {text('targetType', t.logTargetType, 64)}
        {text('targetId', t.logTargetId, 64)}
        <FilterField label={t.logFrom}>
          <input type="datetime-local" value={draft.from} onChange={(change) => set('from', change.target.value)} />
        </FilterField>
        <FilterField label={t.logTo}>
          <input type="datetime-local" value={draft.to} onChange={(change) => set('to', change.target.value)} />
        </FilterField>
        {text('q', t.logSearch, 200)}
        <button className="button button-primary" type="submit">{t.applyFilters}</button>
        <button className="button button-secondary" type="button" onClick={reset}>{t.resetFilters}</button>
      </form>
      <div className="admin-toolbar">
        <LogExportButtons endpoint={ENDPOINT} filters={filters} kind="audit" />
      </div>
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
                <th scope="col">{t.logActor}</th>
                <th scope="col">{t.logAction}</th>
                <th scope="col">{t.logTarget}</th>
                <th scope="col">{t.logOutcome}</th>
                <th scope="col">{t.logDetails}</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((entry) => {
                const open = expanded === entry.id;
                const detailsId = `audit-log-${entry.id}`;
                return (
                  <Fragment key={entry.id}>
                    <tr>
                      <td className="log-time"><LogTime value={entry.at} /></td>
                      <td>
                        {entry.actorType === 'admin' ? t.actorAdmin : t.actorAnonymous}
                        {entry.actor && <><br /><strong>{entry.actor}</strong></>}
                      </td>
                      <td><code>{entry.action}</code></td>
                      <td>
                        {entry.targetType && <code>{entry.targetType}</code>}
                        {entry.targetId && <><br /><code className="log-id">{entry.targetId}</code></>}
                      </td>
                      <td>
                        <LogPill tone={outcomeTone(entry.outcome)} label={outcomeLabel(t, entry.outcome)} />{' '}
                        <span className="field-help">{entry.statusCode}{entry.count > 1 ? ` ×${entry.count}` : ''}</span>
                      </td>
                      <td><DetailsToggle open={open} controls={detailsId} onToggle={() => setExpanded(open ? null : entry.id)} /></td>
                    </tr>
                    {open && (
                      <tr id={detailsId} className="log-details-row">
                        <td colSpan={6}>
                          <dl className="log-facts">
                            <dt>{t.logClient}</dt><dd>{entry.client}</dd>
                            <dt>HTTP</dt><dd><code>{entry.method} {entry.route}</code></dd>
                            <dt>{t.logStatusCode}</dt><dd>{entry.statusCode}</dd>
                            <dt>{t.logIpHash}</dt><dd><code>{entry.ipHash ?? '—'}</code></dd>
                            <dt>{t.logRequestId}</dt><dd><code>{entry.requestId ?? '—'}</code></dd>
                          </dl>
                          {entry.count > 1 && (
                            <p>{formatTranslation(t.logRepeated, { count: String(entry.count), time: formatLogTime(entry.lastAt, timeZoneOffset) })}</p>
                          )}
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
