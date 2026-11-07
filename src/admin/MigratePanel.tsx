import { useState } from 'react';
import { apiRequest } from '../lib/client';
import { formatTranslation } from '../translations';
import { downloadBlob, errorMessage, useAdmin } from './context';

interface MigrationReport {
  dryRun: boolean;
  events: { toCreate: number; toOverwrite: number; alreadyMigrated: number; skipped: number };
  holidays: { toCreate: number; alreadyPresent: number; skipped: number };
  descriptionsStored: number;
  coversStored: number;
  errors: { file: string; row: number; messages: string[] }[];
  warnings: string[];
  missingFiles: string[];
  unreferencedFiles: string[];
  ignoredEntries: string[];
}

const LAYOUT = `migration.zip
├── csv/
│   ├── publishedEventDB.csv
│   └── publishedHolidayDB.csv
├── markdown/
│   ├── 0000.md
│   └── ...
└── covers/
    ├── 0001.jpg
    └── ...`;

function ReportList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <details open={items.length <= 12}>
      <summary>{title} ({items.length})</summary>
      <ul className="admin-list">{items.map((item, index) => <li key={index}>{item}</li>)}</ul>
    </details>
  );
}

export function MigratePanel() {
  const { t } = useAdmin();
  const [file, setFile] = useState<File | null>(null);
  const [onExisting, setOnExisting] = useState<'skip' | 'overwrite'>('skip');
  const [report, setReport] = useState<MigrationReport | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (mode: 'preview' | 'commit') => {
    if (!file) return;
    const body = new FormData();
    body.set('mode', mode);
    body.set('onExisting', onExisting);
    body.set('zip', file, file.name);
    setBusy(true);
    setMessage('');
    try {
      const result = await apiRequest<MigrationReport>('/api/admin/migrate', { method: 'POST', body });
      setReport(result);
      if (!result.dryRun) setMessage(t.importComplete);
    } catch (error) {
      setReport(null);
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="admin-panel" aria-labelledby="migrate-title">
      <h2 id="migrate-title">{t.tabMigrate}</h2>
      <p>{t.migrateIntro}</p>
      <pre className="admin-pre" aria-label={t.migrateLayout}>{LAYOUT}</pre>
      <p className="admin-notice">{t.migrateWrapperWarning}</p>
      <div className="admin-toolbar">
        <label className="field">
          <span>{t.chooseZip}</span>
          <input type="file" accept=".zip,application/zip"
            onChange={(change) => { setFile(change.target.files?.[0] ?? null); setReport(null); setMessage(''); }} />
        </label>
        <button className="button button-secondary" type="button" disabled={!file || busy} onClick={() => void run('preview')}>
          {t.preview}
        </button>
      </div>
      {message && <p className={report && !report.dryRun ? 'success-note' : 'error-note'} role="status">{message}</p>}
      {report && (
        <>
          <h3>{report.dryRun ? t.preview : t.importComplete}</h3>
          <div className="admin-stats">
            <div><strong>{report.events.toCreate}</strong><span>{t.toCreate}</span></div>
            <div><strong>{report.events.toOverwrite}</strong><span>{t.toOverwrite}</span></div>
            <div><strong>{report.events.alreadyMigrated}</strong><span>{t.alreadyMigrated}</span></div>
            <div><strong>{report.events.skipped}</strong><span>{t.skipped}</span></div>
            <div><strong>{report.holidays.toCreate}</strong><span>{t.holidaysToCreate}</span></div>
            <div><strong>{report.descriptionsStored}</strong><span>{t.descriptionsStored}</span></div>
            <div><strong>{report.coversStored}</strong><span>{t.coversStored}</span></div>
            <div><strong>{report.warnings.length}</strong><span>{t.warnings}</span></div>
          </div>
          <ReportList
            title={t.errors}
            items={report.errors.map((error) => `${error.file} · ${formatTranslation(t.row, { row: error.row })}: ${error.messages.join('; ')}`)}
          />
          <ReportList title={t.warnings} items={report.warnings} />
          <ReportList title={t.missingFiles} items={report.missingFiles} />
          <ReportList title={t.unreferencedFiles} items={report.unreferencedFiles} />
          <div className="admin-toolbar">
            {report.dryRun && (
              <>
                <label className="field">
                  <span>{t.existingEvents}</span>
                  <select value={onExisting} onChange={(change) => setOnExisting(change.target.value as 'skip' | 'overwrite')}>
                    <option value="skip">{t.skipExisting}</option>
                    <option value="overwrite">{t.overwriteExisting}</option>
                  </select>
                </label>
                <button className="button button-primary" type="button" disabled={busy} onClick={() => void run('commit')}>
                  {t.commitMigration}
                </button>
              </>
            )}
            <button className="button button-secondary" type="button"
              onClick={() => downloadBlob(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), `migration-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)}>
              {t.downloadReport}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
