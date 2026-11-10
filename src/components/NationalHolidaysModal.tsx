import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApiHoliday } from '../lib/api';
import { apiRequest, isAbortError } from '../lib/client';
import { sortHolidays } from '../lib/holidays';
import type { NationalHoliday } from '../lib/holidays';
import { getTranslations } from '../translations';
import { CakeIcon, XIcon } from './Icons';
import { useDialog } from './useDialog';

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

  useDialog(dialogRef, closeButtonRef, onClose);

  useEffect(() => {
    const controller = new AbortController();
    setLoadState('loading');

    apiRequest<ApiHoliday[]>('/api/holidays', { signal: controller.signal })
      .then((data) => {
        setHolidays(sortHolidays(data));
        setLoadState('loaded');
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) return;
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
              {holidays.map((holiday) => (
                <li
                  className="holiday-entry"
                  key={holiday.id}
                >
                  <time
                    className="holiday-date"
                    dateTime={holiday.date}
                  >
                    {dateFormatter.format(new Date(`${holiday.date}T00:00:00Z`))}
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
