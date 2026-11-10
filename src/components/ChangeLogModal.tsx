import { useEffect, useRef, useState } from 'react';
import type { ApiChangeLogEntry } from '../lib/api';
import { apiRequest, isAbortError } from '../lib/client';
import { splitChanges } from '../lib/validation';
import { getTranslations } from '../translations';
import { HistoryIcon, XIcon } from './Icons';
import { useDialog } from './useDialog';

interface ChangeLogModalProps {
  locale: string;
  onClose: () => void;
}

type LoadState = 'loading' | 'loaded' | 'error';

export function ChangeLogModal({ locale, onClose }: ChangeLogModalProps) {
  const translations = getTranslations(locale);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [entries, setEntries] = useState<{ date: string; changes: string[] }[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [requestVersion, setRequestVersion] = useState(0);

  useDialog(dialogRef, closeButtonRef, onClose);

  useEffect(() => {
    const controller = new AbortController();
    setLoadState('loading');

    apiRequest<ApiChangeLogEntry[]>('/api/changelog', { signal: controller.signal })
      .then((data) => {
        setEntries(data.map((entry) => ({ date: entry.date, changes: splitChanges(entry.changes) })));
        setLoadState('loaded');
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) return;
        console.error('Unable to load change log', error);
        setLoadState('error');
      });

    return () => controller.abort();
  }, [requestVersion]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(mouseEvent) => {
        if (mouseEvent.target === mouseEvent.currentTarget) onClose();
      }}
    >
      <div
        id="change-log-dialog"
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-log-dialog-title"
        ref={dialogRef}
      >
        <header className="settings-modal-header">
          <div className="settings-modal-title">
            <HistoryIcon />
            <h2 id="change-log-dialog-title">{translations.changeLog}</h2>
          </div>
          <button
            ref={closeButtonRef}
            className="button button-icon settings-close"
            type="button"
            onClick={onClose}
            aria-label={translations.closeChangeLog}
          >
            <XIcon />
          </button>
        </header>

        <div className="settings-scroll-region">
          {loadState === 'loading' && (
            <p className="loading-note" role="status">
              {translations.loadingChangeLog}
            </p>
          )}
          {loadState === 'error' && (
            <div className="change-log-state" role="alert">
              <p className="error-note">{translations.changeLogLoadError}</p>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setRequestVersion((version) => version + 1)}
              >
                {translations.retrySync}
              </button>
            </div>
          )}
          {loadState === 'loaded' && entries.length === 0 && (
            <p className="empty-note">{translations.noChangeLogEntries}</p>
          )}
          {loadState === 'loaded' && entries.length > 0 && (
            <ol className="change-log-list">
              {entries.map((entry, index) => (
                <li className="change-log-entry" key={`${entry.date}-${index}`}>
                  <h3>{entry.date}</h3>
                  {entry.changes.length > 0 && (
                    <ul>
                      {entry.changes.map((change, changeIndex) => (
                        <li key={`${change}-${changeIndex}`}>{change}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
