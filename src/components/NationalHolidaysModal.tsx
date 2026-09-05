import { useEffect, useMemo, useRef, useState } from 'react';
import { NATIONAL_HOLIDAYS_URL } from '../config';
import { parseNationalHolidaysCsv } from '../lib/holidays';
import type { NationalHoliday } from '../lib/holidays';
import { withCacheBuster } from '../lib/urls';
import { getTranslations } from '../translations';
import { CakeIcon, XIcon } from './Icons';

interface NationalHolidaysModalProps {
  locale: string;
  onClose: () => void;
}

type LoadState = 'loading' | 'loaded' | 'error';

export function NationalHolidaysModal({
  locale,
  onClose,
}: NationalHolidaysModalProps) {
  const translations = getTranslations(locale);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [holidays, setHolidays] = useState<NationalHoliday[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [requestVersion, setRequestVersion] = useState(0);
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, {
      dateStyle: 'long',
      timeZone: 'UTC',
    }),
    [locale],
  );

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

    fetch(withCacheBuster(NATIONAL_HOLIDAYS_URL), {
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'text/csv, text/plain;q=0.9' },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`National holidays request failed (${response.status})`);
        }
        return response.text();
      })
      .then((csv) => {
        setHolidays(parseNationalHolidaysCsv(csv));
        setLoadState('loaded');
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        console.error('Unable to load AGT national holidays', error);
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
        id="national-holidays-dialog"
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="national-holidays-dialog-title"
        ref={dialogRef}
      >
        <header className="settings-modal-header">
          <div className="settings-modal-title">
            <CakeIcon />
            <h2 id="national-holidays-dialog-title">
              {translations.nationalHolidays}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            className="button button-icon settings-close"
            type="button"
            onClick={onClose}
            aria-label={translations.closeNationalHolidays}
          >
            <XIcon />
          </button>
        </header>

        <div className="settings-scroll-region">
          {loadState === 'loading' && (
            <p className="loading-note" role="status">
              {translations.loadingNationalHolidays}
            </p>
          )}
          {loadState === 'error' && (
            <div className="change-log-state" role="alert">
              <p className="error-note">
                {translations.nationalHolidaysLoadError}
              </p>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setRequestVersion((version) => version + 1)}
              >
                {translations.retrySync}
              </button>
            </div>
          )}
          {loadState === 'loaded' && holidays.length === 0 && (
            <p className="empty-note">{translations.noNationalHolidays}</p>
          )}
          {loadState === 'loaded' && holidays.length > 0 && (
            <ol className="holidays-list">
              {holidays.map((holiday, index) => (
                <li
                  className="holiday-entry"
                  key={`${holiday.date.toISOString()}-${holiday.name}-${index}`}
                >
                  <time
                    className="holiday-date"
                    dateTime={holiday.date.toISOString().slice(0, 10)}
                  >
                    {dateFormatter.format(holiday.date)}
                  </time>
                  <h3>{holiday.name}</h3>
                  <dl className="holiday-details">
                    <div>
                      <dt>{translations.host}</dt>
                      <dd>{holiday.civilization}</dd>
                    </div>
                    <div>
                      <dt>{translations.eventType}</dt>
                      <dd>{holiday.type}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
