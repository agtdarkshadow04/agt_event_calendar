import { useEffect, useMemo, useRef, useState } from 'react';
import { migrateLegacyBookmarks, parseBookmarksCsv, resolveBookmarks, serializeBookmarks } from '../lib/bookmarks';
import { formatAtUtcOffset } from '../lib/date';
import { filterEvents } from '../lib/filter';
import { formatTranslation, getTranslations } from '../translations';
import type { CalendarEvent } from '../types';
import { BookmarkIcon, XIcon } from './Icons';
import { useDialog } from './useDialog';

interface BookmarksModalProps {
  ids: string[];
  events: CalendarEvent[];
  loadState: 'loading' | 'success' | 'error';
  locale: string;
  timeZoneOffset: number;
  bookmarkError: string;
  onChange: (update: (ids: string[]) => string[]) => boolean;
  onSelectEvent: (event: CalendarEvent) => void;
  onClose: () => void;
}

export function BookmarksModal({
  ids,
  events,
  loadState,
  locale,
  timeZoneOffset,
  bookmarkError,
  onChange,
  onSelectEvent,
  onClose,
}: BookmarksModalProps) {
  const translations = getTranslations(locale);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef(false);
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const [feedback, setFeedback] = useState({ error: false, message: '' });
  const resolved = useMemo(() => resolveBookmarks(events, ids), [events, ids]);
  const matchingEvents = useMemo(() => filterEvents(resolved.events, {
    search,
    type: '',
    civilization: '',
    galaxy: '',
    dateContext: 'all',
  }), [resolved.events, search]);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);
  useDialog(dialogRef, closeButtonRef, onClose);

  const changeBookmarks = (update: (ids: string[]) => string[], message: string) => {
    const saved = onChange(update);
    setFeedback({ error: false, message: saved ? message : '' });
  };

  const importBookmarks = async (file: File) => {
    setImporting(true);
    setFeedback({ error: false, message: '' });
    try {
      const csv = await file.text();
      if (!activeRef.current) return;
      // Legacy 4-hex IDs are converted to the migrated events' UUIDs on import.
      const imported = migrateLegacyBookmarks(parseBookmarksCsv(csv, locale), events).ids;
      changeBookmarks(
        (current) => [...new Set([...current, ...imported])],
        translations.bookmarksImported,
      );
    } catch (error: unknown) {
      if (!activeRef.current) return;
      setFeedback({
        error: true,
        message: error instanceof Error ? error.message : translations.bookmarksImportError,
      });
    } finally {
      if (activeRef.current) {
        setImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    }
  };

  const exportBookmarks = () => {
    let url: string | null = null;
    let link: HTMLAnchorElement | null = null;
    try {
      url = URL.createObjectURL(new Blob([serializeBookmarks(ids)], {
        type: 'text/csv;charset=utf-8',
      }));
      link = document.createElement('a');
      link.href = url;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      link.download = `AGT Event Calendar Bookmarks - ${timestamp}.csv`;
      document.body.appendChild(link);
      link.click();
      setFeedback({ error: false, message: translations.bookmarksExported });
    } catch (error: unknown) {
      console.error('Unable to export bookmarks', error);
      setFeedback({ error: true, message: translations.bookmarksExportError });
    } finally {
      link?.remove();
      if (url) URL.revokeObjectURL(url);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(mouseEvent) => {
        if (mouseEvent.target === mouseEvent.currentTarget) onClose();
      }}
    >
      <div
        id="bookmarks-dialog"
        className="settings-modal bookmarks-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bookmarks-dialog-title"
        aria-describedby="bookmarks-backup-notice"
        ref={dialogRef}
      >
        <header className="settings-modal-header">
          <div className="settings-modal-title">
            <BookmarkIcon />
            <h2 id="bookmarks-dialog-title">{translations.bookmarks}</h2>
          </div>
          <button
            ref={closeButtonRef}
            className="button button-icon settings-close"
            type="button"
            onClick={onClose}
            aria-label={translations.closeBookmarks}
          >
            <XIcon />
          </button>
        </header>

        <div className="settings-scroll-region">
          <p id="bookmarks-backup-notice" className="bookmarks-warning">
            {translations.bookmarksBackupNotice}
          </p>
          {bookmarkError && <p className="error-note" role="alert">{bookmarkError}</p>}
          <label className="field">
            <span>{translations.search}</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={translations.searchPlaceholder}
            />
          </label>

          {loadState === 'success' ? (
            <>
              {resolved.missingIds.length > 0 && (
                <div className="bookmarks-warning" role="status">
                  <p>{formatTranslation(translations.missingBookmarks, {
                    count: resolved.missingIds.length,
                  })}</p>
                  <p className="monospace">{resolved.missingIds.join(', ')}</p>
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => changeBookmarks(
                      (current) => current.filter((id) => !resolved.missingIds.includes(id)),
                      translations.missingBookmarksRemoved,
                    )}
                  >
                    {translations.removeMissingBookmarks}
                  </button>
                </div>
              )}
              <ul className="bookmarks-list">
                {matchingEvents.map((event) => (
                  <li key={event.id}>
                    <button
                      className="button button-secondary bookmark-event"
                      type="button"
                      onClick={() => onSelectEvent(event)}
                    >
                      <strong>{event.name}</strong>
                      <span>{event.id} · {event.type} · {event.galaxy}</span>
                      <time dateTime={event.start.toISOString()}>
                        {formatAtUtcOffset(event.start, locale, timeZoneOffset, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </time>
                    </button>
                  </li>
                ))}
              </ul>
              {matchingEvents.length === 0 && (
                <p role="status">
                  {ids.length === 0 ? translations.noBookmarks : translations.noMatchingBookmarks}
                </p>
              )}
            </>
          ) : (
            <p role="status">
              {loadState === 'loading' ? translations.syncingDatabase : translations.eventsCouldNotBeLoaded}
            </p>
          )}
        </div>

        <footer className="settings-modal-footer">
          <div
            className={`settings-import-status${feedback.error ? ' error-note' : ''}`}
            role={feedback.error ? 'alert' : 'status'}
            aria-live="polite"
          >
            {feedback.message}
          </div>
          <input
            ref={fileInputRef}
            hidden
            type="file"
            accept="text/csv,.csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importBookmarks(file);
            }}
          />
          <button
            className="button button-secondary"
            type="button"
            disabled={ids.length === 0 || importing}
            onClick={() => changeBookmarks(() => [], translations.bookmarksCleared)}
          >
            {translations.clearAll}
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
          >
            {translations.import}
          </button>
          <button className="button button-primary" type="button" onClick={exportBookmarks}>
            {translations.export}
          </button>
        </footer>
      </div>
    </div>
  );
}
