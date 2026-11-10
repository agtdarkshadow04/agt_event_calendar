import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, apiRequest } from '../lib/client';
import { loadSettings, resolveTimeZone } from '../lib/settings';
import { formatTranslation, getTranslations } from '../translations';
import { AccountPanel } from './AccountPanel';
import { AuditLogPanel } from './AuditLogPanel';
import { BackupPanel } from './BackupPanel';
import { ChangeLogPanel, HolidaysPanel } from './ContentPanels';
import { AdminContext, errorMessage, useAdmin } from './context';
import { EventsPanel } from './EventsPanel';
import { getAdminTranslations } from './i18n';
import { ImagesPanel } from './ImagesPanel';
import { MigratePanel } from './MigratePanel';
import { ServerLogPanel } from './ServerLogPanel';
import { SettingsPanel } from './SettingsPanel';
import { MaintenanceNotice } from '../components/MaintenanceNotice';

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'setup'; setupPasswordConfigured: boolean }
  | { kind: 'login' }
  | { kind: 'dashboard'; username: string; setupPasswordStillSet: boolean; version: string };

const TABS = [
  'events', 'moderation', 'holidays', 'changelog', 'images', 'settings', 'serverLog', 'auditLog', 'migrate', 'backup', 'account',
] as const;
type Tab = (typeof TABS)[number];

function SetupScreen({ configured, onDone }: { configured: boolean; onDone: () => void }) {
  const { t } = useAdmin();
  const [form, setForm] = useState({ setupPassword: '', username: '', password: '', confirm: '' });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (form.password !== form.confirm) {
      setMessage(t.passwordsDiffer);
      return;
    }
    setBusy(true);
    try {
      await apiRequest('/api/setup', {
        method: 'POST',
        json: { setupPassword: form.setupPassword, username: form.username, password: form.password },
      });
      onDone();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const input = (key: keyof typeof form, label: string, type = 'password', autoComplete = 'new-password') => (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={form[key]} autoComplete={autoComplete} required
        onChange={(event) => setForm({ ...form, [key]: event.target.value })} />
    </label>
  );
  return (
    <section className="admin-panel admin-auth" aria-labelledby="setup-title">
      <h2 id="setup-title">{t.setupTitle}</h2>
      {!configured ? (
        <p className="admin-notice danger" role="alert">{t.setupPasswordMissing}</p>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          <p>{t.setupIntro}</p>
          {input('setupPassword', t.setupPassword, 'password', 'off')}
          {input('username', t.username, 'text', 'username')}
          {input('password', t.newPassword)}
          {input('confirm', t.confirmPassword)}
          <small className="field-help">{t.passwordHint}</small>
          {message && <p className="error-note" role="alert">{message}</p>}
          <button className="button button-primary" type="submit" disabled={busy}>{t.createAdmin}</button>
        </form>
      )}
    </section>
  );
}

function LoginScreen({ onDone, notice }: { onDone: () => void; notice: string }) {
  const { t } = useAdmin();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await apiRequest('/api/admin/login', { method: 'POST', json: { username, password } });
      onDone();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="admin-panel admin-auth" aria-labelledby="login-title">
      <h2 id="login-title">{t.signIn}</h2>
      {notice && <p className="success-note" role="status">{notice}</p>}
      <form onSubmit={(event) => void submit(event)}>
        <label className="field">
          <span>{t.username}</span>
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required />
        </label>
        <label className="field">
          <span>{t.password}</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
        </label>
        {message && <p className="error-note" role="alert">{message}</p>}
        <button className="button button-primary" type="submit" disabled={busy}>{t.signIn}</button>
      </form>
    </section>
  );
}

export function AdminApp() {
  const settings = useMemo(() => {
    try {
      return loadSettings();
    } catch {
      return null;
    }
  }, []);
  const locale = settings?.locale ?? 'en';
  const zone = useMemo(() => resolveTimeZone(settings?.timeZone ?? 'Auto'), [settings]);
  const context = useMemo(() => ({
    t: getAdminTranslations(locale),
    pt: getTranslations(locale),
    locale,
    timeZone: zone.label,
    timeZoneOffset: zone.offsetMinutes,
  }), [locale, zone]);
  const { t } = context;
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [tab, setTab] = useState<Tab>('events');
  const [pendingCount, setPendingCount] = useState(0);
  const [logSummary, setLogSummary] = useState({ unseenWarnings: 0, unseenErrors: 0 });
  const [loginNotice, setLoginNotice] = useState('');

  const refresh = useCallback(async () => {
    try {
      const status = await apiRequest<{ adminExists: boolean; setupPasswordConfigured: boolean }>('/api/setup/status');
      if (!status.adminExists) {
        setPhase({ kind: 'setup', setupPasswordConfigured: status.setupPasswordConfigured });
        return;
      }
      try {
        const session = await apiRequest<{ username: string; setupPasswordStillSet: boolean; version: string }>('/api/admin/session');
        setPhase({
          kind: 'dashboard',
          username: session.username,
          setupPasswordStillSet: session.setupPasswordStillSet,
          version: session.version,
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) setPhase({ kind: 'login' });
        else throw error;
      }
    } catch (error) {
      setPhase({ kind: 'error', message: errorMessage(error) });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t.title;
  }, [locale, t.title]);

  const refreshPending = useCallback(async () => {
    try {
      setPendingCount((await apiRequest<unknown[]>('/api/admin/events?status=pending')).length);
    } catch {
      // Shown in the moderation tab itself.
    }
  }, []);

  useEffect(() => {
    if (phase.kind === 'dashboard') void refreshPending();
  }, [phase.kind, refreshPending, tab]);

  // Unseen server log warnings and errors: fetched when the dashboard loads and
  // when tabs change, never polled in the background. Opening the Server log
  // tab marks them as seen.
  const refreshLogSummary = useCallback(async (markSeen: boolean) => {
    try {
      setLogSummary(await apiRequest<{ unseenWarnings: number; unseenErrors: number }>(
        markSeen ? '/api/admin/logs/server/seen' : '/api/admin/logs/server/summary',
        { method: markSeen ? 'POST' : 'GET' },
      ));
    } catch {
      // The badge is optional; the Server log tab shows its own errors.
    }
  }, []);

  useEffect(() => {
    if (phase.kind === 'dashboard') void refreshLogSummary(tab === 'serverLog');
  }, [phase.kind, refreshLogSummary, tab]);

  const unseenLogEntries = logSummary.unseenWarnings + logSummary.unseenErrors;

  const signOut = async () => {
    try {
      await apiRequest('/api/admin/logout', { method: 'POST' });
    } finally {
      setPhase({ kind: 'login' });
    }
  };

  const endedSession = (notice: string) => {
    setLoginNotice(notice);
    setPhase({ kind: 'login' });
  };

  const tabLabels: Record<Tab, string> = {
    events: t.tabEvents,
    moderation: t.tabModeration,
    holidays: t.tabHolidays,
    changelog: t.tabChangeLog,
    images: t.tabImages,
    settings: t.tabSettings,
    serverLog: t.tabServerLog,
    auditLog: t.tabAuditLog,
    migrate: t.tabMigrate,
    backup: t.tabBackup,
    account: t.tabAccount,
  };

  return (
    <AdminContext.Provider value={context}>
      <div className="admin-shell">
        <header className="admin-header">
          <div className="brand-lockup">
            <img className="agt-emblem" src="/AgtOfficialLogo.webp" alt="" aria-hidden="true" />
            <h1>{t.title}</h1>
            {phase.kind === 'dashboard' && (
              <span className="admin-version">{formatTranslation(t.appVersion, { version: phase.version })}</span>
            )}
          </div>
          <div className="admin-header-actions">
            <a href="/">{t.viewSite}</a>
            {phase.kind === 'dashboard' && (
              <>
                {unseenLogEntries > 0 && tab !== 'serverLog' && (
                  <a
                    href="#server-log"
                    className={logSummary.unseenErrors > 0 ? 'admin-log-alert danger' : 'admin-log-alert'}
                    onClick={(event) => { event.preventDefault(); setTab('serverLog'); }}
                  >
                    {formatTranslation(t.unseenServerLog, { count: unseenLogEntries })}
                  </a>
                )}
                <span>{phase.username}</span>
                <button className="button button-secondary" type="button" onClick={() => void signOut()}>{t.signOut}</button>
              </>
            )}
          </div>
        </header>
        <MaintenanceNotice className="admin-notice maintenance-notice" text={t.maintenanceNotice} />
        <main className="admin-main">
          {phase.kind === 'loading' && <p className="loading-note" role="status">{t.loading}</p>}
          {phase.kind === 'error' && <p className="error-note" role="alert">{formatError(t.requestFailed, phase.message)}</p>}
          {phase.kind === 'setup' && <SetupScreen configured={phase.setupPasswordConfigured} onDone={() => void refresh()} />}
          {phase.kind === 'login' && <LoginScreen notice={loginNotice} onDone={() => { setLoginNotice(''); void refresh(); }} />}
          {phase.kind === 'dashboard' && (
            <>
              {phase.setupPasswordStillSet && <p className="admin-notice" role="status">{t.setupPasswordStillSet}</p>}
              <nav className="admin-tabs" role="tablist" aria-label={t.title}>
                {TABS.map((name) => (
                  <button
                    key={name}
                    className="button button-secondary"
                    type="button"
                    role="tab"
                    aria-selected={tab === name}
                    aria-controls="admin-tab-panel"
                    onClick={() => setTab(name)}
                  >
                    {tabLabels[name]}
                    {name === 'moderation' && pendingCount > 0 && <span className="admin-badge">{pendingCount}</span>}
                    {name === 'serverLog' && unseenLogEntries > 0 && (
                      <span className={logSummary.unseenErrors > 0 ? 'admin-badge danger' : 'admin-badge'}>{unseenLogEntries}</span>
                    )}
                  </button>
                ))}
              </nav>
              <div id="admin-tab-panel" role="tabpanel" aria-label={tabLabels[tab]}>
                {tab === 'events' && <EventsPanel moderation={false} onChanged={refreshPending} />}
                {tab === 'moderation' && <EventsPanel moderation onChanged={refreshPending} />}
                {tab === 'holidays' && <HolidaysPanel />}
                {tab === 'changelog' && <ChangeLogPanel />}
                {tab === 'images' && <ImagesPanel />}
                {tab === 'settings' && <SettingsPanel />}
                {tab === 'serverLog' && <ServerLogPanel onCleared={() => void refreshLogSummary(true)} />}
                {tab === 'auditLog' && <AuditLogPanel />}
                {tab === 'migrate' && <MigratePanel />}
                {tab === 'backup' && <BackupPanel onSessionEnded={endedSession} />}
                {tab === 'account' && <AccountPanel />}
              </div>
            </>
          )}
        </main>
      </div>
    </AdminContext.Provider>
  );
}

function formatError(template: string, message: string): string {
  return template.replace('{{message}}', message);
}
