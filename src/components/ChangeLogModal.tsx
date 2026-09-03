import { useEffect, useRef, useState } from 'react';
import { CHANGE_LOG_URL } from '../config';
import { parseChangeLogCsv } from '../lib/changelog';
import type { ChangeLogEntry } from '../lib/changelog';
import { withCacheBuster } from '../lib/urls';
import { getTranslations } from '../translations';
import { HistoryIcon, XIcon } from './Icons';

interface ChangeLogModalProps {
  locale: string;
  onClose: () => void;
}

type LoadState = 'loading' | 'loaded' | 'error';

export function ChangeLogModal({ locale, onClose }: ChangeLogModalProps) {
  const translations = getTranslations(locale);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [entries, setEntries] = useState<ChangeLogEntry[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') {
        keyEvent.preventDefault();
        onClose();
        return;
      }
      if (keyEvent.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (keyEvent.shiftKey && document.activeElement === first) {
        keyEvent.preventDefault();
        last?.focus();
      } else if (!keyEvent.shiftKey && document.activeElement === last) {
        keyEvent.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    const frame = requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    const controller = new AbortController();
    setLoadState('loading');

    fetch(withCacheBuster(CHANGE_LOG_URL), {
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'text/csv, text/plain;q=0.9' },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Change log request failed (${response.status})`);
        }
        return response.text();
      })
      .then((csv) => {
        setEntries(parseChangeLogCsv(csv));
        setLoadState('loaded');
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
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
