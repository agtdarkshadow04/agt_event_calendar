import { useState } from 'react';
import { apiRequest } from '../lib/client';
import { formatTranslation } from '../translations';
import { downloadBlob, errorMessage, useAdmin } from './context';

interface RestoreReport {
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
  counts: { events: number; holidays: number; changelog: number; images: number };
  adminUsername: string | null;
  ignoredSettings: { key: string; reason: string }[];
  droppedFiles: string[];
  config: { included: boolean; applied: false; text: string | null; identical: boolean; diff: string[] };
  preRestoreBackup: string | null;
}

export function BackupPanel({ onSessionEnded }: { onSessionEnded: (notice: string) => void }) {
  const { t, locale } = useAdmin();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<RestoreReport | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const download = () => {
    if (!window.confirm(t.backupWarning)) return;
    const link = document.createElement('a');
    link.href = '/api/admin/backup';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const send = async (action: 'preview' | 'restore') => {
    if (!file) return;
    const body = new FormData();
    body.set('action', action);
    body.set('backup', file, file.name);
    setBusy(true);
    setMessage('');
    try {
      const result = await apiRequest<RestoreReport>('/api/admin/restore', { method: 'POST', body });
      if (action === 'restore') {
        onSessionEnded(`${t.restoreComplete} ${result.preRestoreBackup ? formatTranslation(t.preRestoreBackup, { file: result.preRestoreBackup }) : ''}`);
        return;
      }
      setReport(result);
    } catch (error) {
      setReport(null);
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-stack">
      <section className="admin-panel" aria-labelledby="backup-title">
        <h2 id="backup-title">{t.downloadBackup}</h2>
        <p>{t.backupIntro}</p>
        <p className="admin-notice">{t.backupWarning}</p>
        <div className="admin-toolbar">
          <button className="button button-primary" type="button" onClick={download}>{t.downloadBackup}</button>
        </div>
      </section>

      <section className="admin-panel" aria-labelledby="restore-title">
        <h2 id="restore-title">{t.restore}</h2>
        <p>{t.restoreIntro}</p>
        <div className="admin-toolbar">
          <label className="field">
            <span>{t.chooseBackup}</span>
            <input type="file" accept=".zip,application/zip"
              onChange={(change) => { setFile(change.target.files?.[0] ?? null); setReport(null); setConfirmed(false); setMessage(''); }} />
          </label>
          <button className="button button-secondary" type="button" disabled={!file || busy} onClick={() => void send('preview')}>{t.preview}</button>
        </div>
        {message && <p className="error-note" role="alert">{message}</p>}
        {report && (
          <>
            <h3>{t.backupContents}</h3>
            <p>{new Date(report.createdAt).toLocaleString(locale)} · v{report.appVersion}</p>
            <div className="admin-stats">
              <div><strong>{report.counts.events}</strong><span>{t.tabEvents}</span></div>
              <div><strong>{report.counts.holidays}</strong><span>{t.tabHolidays}</span></div>
              <div><strong>{report.counts.changelog}</strong><span>{t.tabChangeLog}</span></div>
              <div><strong>{report.counts.images}</strong><span>{t.tabImages}</span></div>
              <div><strong>{report.adminUsername ?? '—'}</strong><span>{t.adminAccount}</span></div>
            </div>
            {report.ignoredSettings.length > 0 && (
              <details open>
                <summary>{t.ignoredSettings}</summary>
                <ul className="admin-list">{report.ignoredSettings.map((item) => <li key={item.key}>{item.key}: {item.reason}</li>)}</ul>
              </details>
            )}
            {report.config.included && (
              <div className="admin-notice">
                <p>{t.configIncluded}</p>
                {report.config.identical ? <p>{t.configIdentical}</p> : (
                  <details>
                    <summary>{t.configDiff}</summary>
                    <pre className="admin-pre">
                      {report.config.diff.map((line, index) => (
                        <span key={index} className={line.startsWith('+') ? 'diff-add' : line.startsWith('-') ? 'diff-remove' : undefined}>{line}{'\n'}</span>
                      ))}
                    </pre>
                  </details>
                )}
                <button className="button button-secondary" type="button"
                  onClick={() => downloadBlob(new Blob([report.config.text ?? ''], { type: 'text/yaml' }), 'config.yaml')}>
                  {t.downloadConfig}
                </button>
              </div>
            )}
            <p className="admin-notice danger">{t.restoreWarning}</p>
            <label className="admin-checkbox">
              <input type="checkbox" checked={confirmed} onChange={(change) => setConfirmed(change.target.checked)} />
              {t.confirmRestore}
            </label>
            <div className="admin-toolbar">
              <button className="button button-primary" type="button" disabled={!confirmed || busy} onClick={() => void send('restore')}>
                {t.restore}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
