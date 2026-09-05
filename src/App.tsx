import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calendar } from './components/Calendar';
import { BookmarksModal } from './components/BookmarksModal';
import { ChangeLogModal } from './components/ChangeLogModal';
import { EventModal } from './components/EventModal';
import { FilterBar } from './components/FilterBar';
import {
  BookmarkIcon,
  BugIcon,
  CakeIcon,
  PlusIcon,
  SettingsIcon,
} from './components/Icons';
import { NationalHolidaysModal } from './components/NationalHolidaysModal';
import { SettingsModal } from './components/SettingsModal';
import { BUG_REPORT_URL, EVENT_DATABASE_URL, EVENT_FORM_URL } from './config';
import { parseEventsCsv } from './lib/csv';
import { loadBookmarks, saveBookmarks } from './lib/bookmarks';
import { formatAtUtcOffset } from './lib/date';
import { filterEvents } from './lib/filter';
import {
  loadSettings,
  resolveTimeZone,
  saveSettings,
} from './lib/settings';
import { withCacheBuster, withEventId } from './lib/urls';
import { formatTranslation, getTranslations } from './translations';
import type {
  CalendarEvent,
  DataWarning,
  EventFilters,
} from './types';

const INITIAL_FILTERS: EventFilters = {
  search: '',
  type: '',
  civilization: '',
  galaxy: '',
  dateContext: 'all',
};

type LoadState = 'loading' | 'success' | 'error';

interface BookmarkState {
  ids: string[];
  error: 'load' | 'save' | null;
}

function App() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [warnings, setWarnings] = useState<DataWarning[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadErrorStatus, setLoadErrorStatus] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [filters, setFilters] = useState<EventFilters>(INITIAL_FILTERS);
  const [viewDate, setViewDate] = useState(() => new Date());
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [settings, setSettings] = useState(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [showChangeLog, setShowChangeLog] = useState(false);
  const [showNationalHolidays, setShowNationalHolidays] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [bookmarks, setBookmarks] = useState<BookmarkState>(() => {
    try {
      return { ids: loadBookmarks(), error: null };
    } catch (error: unknown) {
      console.error('Unable to load cached bookmarks', error);
      return { ids: [], error: 'load' };
    }
  });
  const bookmarksRef = useRef(bookmarks);
  const audioRef = useRef<HTMLAudioElement>(null);
  const csvRef = useRef<string | null>(null);
  const localeRef = useRef(settings.locale);
  localeRef.current = settings.locale;
  const translations = getTranslations(settings.locale);
  const bookmarkError = bookmarks.error === 'load'
    ? translations.bookmarksLoadError
    : bookmarks.error === 'save'
      ? translations.bookmarksSaveError
      : '';
  const { label: timeZone, offsetMinutes: timeZoneOffset } = useMemo(
    () => resolveTimeZone(settings.timeZone),
    [settings.timeZone],
  );

  const loadEvents = useCallback(async () => {
    setLoadState('loading');
    setLoadErrorStatus(null);

    let responseStatus: number | null = null;
    try {
      const response = await fetch(withCacheBuster(EVENT_DATABASE_URL), {
        cache: 'no-store',
        headers: { Accept: 'text/csv, text/plain;q=0.9' },
      });
      if (!response.ok) {
        responseStatus = response.status;
        throw new Error(`Event database HTTP ${response.status}`);
      }

      const csv = await response.text();
      csvRef.current = csv;
      const parsed = parseEventsCsv(csv, localeRef.current);
      setEvents(parsed.events);
      setWarnings(parsed.warnings);
      setUpdatedAt(new Date());
      setLoadState('success');
    } catch (error: unknown) {
      console.error('Unable to load AGT event database', error);
      setLoadErrorStatus(responseStatus);
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    try {
      saveSettings(settings);
    } catch (error: unknown) {
      console.error('Unable to cache calendar settings', error);
    }
  }, [settings]);

  useEffect(() => {
    const root = document.documentElement;
    const previousFontSize = root.style.fontSize;
    const previousLanguage = root.lang;
    const previousTitle = document.title;
    root.style.fontSize = `${Number.parseFloat(settings.fontScale) * 100}%`;
    root.lang = settings.locale;
    document.title = translations.productName;
    return () => {
      root.style.fontSize = previousFontSize;
      root.lang = previousLanguage;
      document.title = previousTitle;
    };
  }, [settings.fontScale, settings.locale, translations.productName]);

  useEffect(() => {
    if (!csvRef.current) return;
    const parsed = parseEventsCsv(csvRef.current, settings.locale);
    setEvents(parsed.events);
    setWarnings(parsed.warnings);
  }, [settings.locale]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = 0.4;
    audio.muted = settings.anthem === 'mute';
    if (settings.anthem === 'mute') audio.pause();
  }, [settings.anthem]);

  useEffect(() => {
    const playAfterInteraction = () => {
      if (settings.anthem === 'unmute' && audioRef.current) {
        void audioRef.current.play().catch(() => {
          // Browsers may still deny media playback for non-qualifying interactions.
        });
      }
      removeInteractionListeners();
    };
    const removeInteractionListeners = () => {
      window.removeEventListener('pointerdown', playAfterInteraction);
      window.removeEventListener('keydown', playAfterInteraction);
    };

    window.addEventListener('pointerdown', playAfterInteraction);
    window.addEventListener('keydown', playAfterInteraction);
    return removeInteractionListeners;
  }, [settings.anthem]);

  useEffect(() => {
    const selectEventFromUrl = () => {
      const eventId = new URL(window.location.href).searchParams.get('event_id');
      setSelectedEvent(
        eventId ? events.find((event) => event.id === eventId) ?? null : null,
      );
    };

    selectEventFromUrl();
    window.addEventListener('popstate', selectEventFromUrl);
    return () => window.removeEventListener('popstate', selectEventFromUrl);
  }, [events]);

  const filteredEvents = useMemo(
    () => filterEvents(events, filters, new Date(), timeZoneOffset),
    [events, filters, timeZoneOffset],
  );
  const skippedRows = warnings.filter((warning) => warning.skipped).length;

  const selectEvent = useCallback((event: CalendarEvent) => {
    setSelectedEvent(event);
    window.history.replaceState(
      window.history.state,
      '',
      withEventId(window.location.href, event.id),
    );
  }, []);

  const closeSelectedEvent = useCallback(() => {
    setSelectedEvent(null);
    window.history.replaceState(
      window.history.state,
      '',
      withEventId(window.location.href, null),
    );
  }, []);

  const closeSettings = useCallback(() => setShowSettings(false), []);
  const closeChangeLog = useCallback(() => setShowChangeLog(false), []);
  const closeNationalHolidays = useCallback(
    () => setShowNationalHolidays(false),
    [],
  );
  const closeBookmarks = useCallback(() => setShowBookmarks(false), []);
  const openChangeLog = useCallback(() => {
    setShowSettings(false);
    setShowChangeLog(true);
  }, []);

  const changeBookmarks = useCallback((update: (ids: string[]) => string[]) => {
    try {
      const ids = update(bookmarksRef.current.ids);
      saveBookmarks(ids);
      bookmarksRef.current = { ids, error: null };
      setBookmarks(bookmarksRef.current);
      return true;
    } catch (error: unknown) {
      console.error('Unable to cache bookmarks', error);
      bookmarksRef.current = { ...bookmarksRef.current, error: 'save' };
      setBookmarks(bookmarksRef.current);
      return false;
    }
  }, []);

  const toggleBookmark = (id: string) => {
    return changeBookmarks((ids) => ids.includes(id)
      ? ids.filter((savedId) => savedId !== id)
      : [...ids, id]);
  };

  const selectBookmarkedEvent = (event: CalendarEvent) => {
    setShowBookmarks(false);
    selectEvent(event);
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {translations.skipToCalendar}
      </a>

      <header className="site-header">
        <div className="header-content">
          <div className="brand-lockup">
            <img
              className="agt-emblem"
              src="/AgtOfficialLogo.webp"
              alt=""
              aria-hidden="true"
            />
            <div>
              <p className="brand-name">{translations.brandName}</p>
              <p className="product-name">{translations.productName}</p>
            </div>
          </div>

          <div className="header-actions">
            <div
              className={`connection-status status-${loadState}`}
              role="status"
              aria-live="polite"
            >
              <span className="status-dot" aria-hidden="true" />
              <span>
                {loadState === 'loading'
                  ? translations.syncingDatabase
                  : loadState === 'error'
                    ? translations.databaseOffline
                    : translations.databaseLive}
              </span>
            </div>
            <a
              className="add-event-link"
              href={EVENT_FORM_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={translations.addEvent}
              title={translations.addEvent}
            >
              <PlusIcon className="add-event-link-icon" />
            </a>
            <button
              className="bookmarks-button"
              type="button"
              onClick={() => setShowBookmarks(true)}
              aria-label={translations.bookmarks}
              aria-haspopup="dialog"
              aria-expanded={showBookmarks}
              aria-controls="bookmarks-dialog"
              title={translations.bookmarks}
            >
              <BookmarkIcon className="bookmarks-button-icon" />
            </button>
            <button
              className="national-holidays-button"
              type="button"
              onClick={() => setShowNationalHolidays(true)}
              aria-label={translations.nationalHolidays}
              aria-haspopup="dialog"
              aria-expanded={showNationalHolidays}
              aria-controls="national-holidays-dialog"
              title={translations.nationalHolidays}
            >
              <CakeIcon className="national-holidays-button-icon" />
            </button>
            <a
              className="bug-link"
              href={BUG_REPORT_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={translations.contactSupport}
              title={translations.contactSupport}
            >
              <BugIcon className="bug-link-icon" />
            </a>
            <button
              className="settings-button"
              type="button"
              onClick={() => setShowSettings(true)}
              aria-label={translations.openSettings}
              aria-haspopup="dialog"
              aria-expanded={showSettings}
              aria-controls="settings-dialog"
              title={translations.settings}
            >
              <SettingsIcon className="settings-button-icon" />
            </button>
          </div>
        </div>
        <div className="header-divider" />
      </header>

      <main id="main-content" className="main-content">
        <section className="intro" aria-labelledby="page-heading">
          <h1 id="page-heading">{translations.pageHeading}</h1>
          <p>{translations.pageIntro}</p>
        </section>

        {loadState === 'loading' && (
          <section className="state-panel loading-panel" aria-live="polite">
            <div className="orbit-loader" aria-hidden="true">
              <span>AGT</span>
            </div>
            <div>
              <h2>{translations.syncHeading}</h2>
              <p>{translations.syncDescription}</p>
            </div>
          </section>
        )}

        {loadState === 'error' && (
          <section className="state-panel error-panel" role="alert">
            <div>
              <p className="eyebrow">{translations.databaseError}</p>
              <h2>{translations.eventsCouldNotBeLoaded}</h2>
              <p>
                {loadErrorStatus === null
                  ? translations.unexpectedDatabaseError
                  : formatTranslation(translations.databaseHttpError, {
                      status: loadErrorStatus,
                    })}
              </p>
              <p>{translations.databaseInstructions}</p>
            </div>
            <button className="button button-primary" type="button" onClick={loadEvents}>
              {translations.retrySync}
            </button>
          </section>
        )}

        {loadState === 'success' && (
          <>
            <section className="data-meta" aria-label={translations.databaseStatus}>
              <div>
                <span className="data-count">{events.length}</span>
                <span>
                  {events.length === 1
                    ? translations.validEventRecord
                    : translations.validEventRecords}
                </span>
              </div>
              <div>
                <span className="data-count">{filteredEvents.length}</span>
                <span>{translations.matchingFilters}</span>
              </div>
              <div>
                <span className="data-count">{bookmarks.ids.length}</span>
                <span>{translations.bookmarked}</span>
              </div>
              <div className="sync-time">
                <span>{translations.lastSync}</span>
                <time dateTime={updatedAt?.toISOString()}>
                  {updatedAt
                    ? formatAtUtcOffset(
                        updatedAt,
                        settings.locale,
                        timeZoneOffset,
                        { hour: '2-digit', minute: '2-digit' },
                      )
                    : ''}
                </time>
              </div>
            </section>

            {warnings.length > 0 && (
              <details className="warning-panel">
                <summary>
                  <span aria-hidden="true">!</span>
                  {formatTranslation(translations.databaseLoadedWith, {
                    count: warnings.length,
                    warningLabel:
                      warnings.length === 1
                        ? translations.warning
                        : translations.warnings,
                    skipped:
                      skippedRows > 0
                        ? formatTranslation(translations.malformedRowsSkipped, {
                            count: skippedRows,
                          })
                        : '',
                  })}
                </summary>
                <div className="warning-details">
                  <p>{translations.validEventsRemain}</p>
                  <ul>
                    {warnings.map((warning, index) => (
                      <li key={`${warning.row}-${index}`}>
                        <strong>
                          {formatTranslation(translations.rowLabel, {
                            row: warning.row,
                          })}
                        </strong>{' '}
                        {warning.messages.join('; ')}
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            )}

            <FilterBar
              events={events}
              filters={filters}
              locale={settings.locale}
              onChange={setFilters}
            />

            {events.length === 0 ? (
              <section className="state-panel empty-panel">
                <div>
                  <p className="eyebrow">{translations.archiveEmpty}</p>
                  <h2>{translations.noValidEvents}</h2>
                  <p>{translations.emptyArchiveDescription}</p>
                </div>
              </section>
            ) : (
              <Calendar
                events={filteredEvents}
                viewDate={viewDate}
                locale={settings.locale}
                timeZone={timeZone}
                timeZoneOffset={timeZoneOffset}
                onViewDateChange={setViewDate}
                onSelectEvent={selectEvent}
              />
            )}
          </>
        )}
      </main>

      <footer className="site-footer">
        <div className="footer-content">
          <nav className="footer-links" aria-label={translations.brandName}>
            <a href="https://www.nms-agt.com" target="_blank" rel="noopener noreferrer">{translations.home}</a>
            <span className="footer-separator" aria-hidden="true">|</span>
            <a href="https://www.nms-agt.com/about-the-agt" target="_blank" rel="noopener noreferrer">{translations.about}</a>
            <span className="footer-separator" aria-hidden="true">|</span>
            <a href="https://www.nms-agt.com/team" target="_blank" rel="noopener noreferrer">{translations.team}</a>
            <span className="footer-separator" aria-hidden="true">|</span>
            <a href="https://www.nms-agt.com/contribute" target="_blank" rel="noopener noreferrer">{translations.contribute}</a>
            <span className="footer-separator" aria-hidden="true">|</span>
            <a href="https://www.nms-agt.com/agt-galactic-archives" target="_blank" rel="noopener noreferrer">{translations.galacticArchives}</a>
            <span className="footer-separator" aria-hidden="true">|</span>
            <a href="https://www.nms-agt.com/engage" target="_blank" rel="noopener noreferrer">{translations.engage}</a>
            <span className="footer-separator" aria-hidden="true">|</span>
            <a href="https://www.nms-agt.com/agt-navi" target="_blank" rel="noopener noreferrer">{translations.agtNavi}</a>
            <span className="footer-separator" aria-hidden="true">|</span>
            <a href="https://www.nms-agt.com/terms" target="_blank" rel="noopener noreferrer">{translations.terms}</a>
            <span className="footer-separator" aria-hidden="true">|</span>
            <a href="https://www.nms-agt.com/support" target="_blank" rel="noopener noreferrer">{translations.support}</a>
            <span className="footer-separator" aria-hidden="true">|</span>
            <a href="https://www.nms-agt.com/terms/copyright" target="_blank" rel="noopener noreferrer">{translations.copyright}</a>
          </nav>
          <p className="footer-copyright">
            {formatTranslation(translations.copyrightNotice, {
              year: new Date().getFullYear(),
            })}
          </p>
        </div>
      </footer>

      <audio
        ref={audioRef}
        src="/agt-anthem-instrumental.mp3"
        loop
        preload="auto"
      />

      {showSettings && (
        <SettingsModal
          settings={settings}
          onChange={setSettings}
          onReloadDatabase={loadState === 'success' ? loadEvents : undefined}
          onOpenChangeLog={openChangeLog}
          onClose={closeSettings}
        />
      )}

      {showChangeLog && (
        <ChangeLogModal
          locale={settings.locale}
          onClose={closeChangeLog}
        />
      )}

      {showBookmarks && (
        <BookmarksModal
          ids={bookmarks.ids}
          events={events}
          loadState={loadState}
          locale={settings.locale}
          timeZoneOffset={timeZoneOffset}
          bookmarkError={bookmarkError}
          onChange={changeBookmarks}
          onSelectEvent={selectBookmarkedEvent}
          onClose={closeBookmarks}
        />
      )}

      {showNationalHolidays && (
        <NationalHolidaysModal
          locale={settings.locale}
          onClose={closeNationalHolidays}
        />
      )}

      <EventModal
        selectedEvent={selectedEvent}
        locale={settings.locale}
        timeZone={timeZone}
        timeZoneOffset={timeZoneOffset}
        bookmarked={selectedEvent !== null && bookmarks.ids.includes(selectedEvent.id)}
        bookmarkError={bookmarkError}
        onToggleBookmark={toggleBookmark}
        onClose={closeSelectedEvent}
      />
    </div>
  );
}

export default App;
