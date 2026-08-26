import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar } from './components/Calendar';
import { EventModal } from './components/EventModal';
import { FilterBar } from './components/FilterBar';
import { BUG_REPORT_URL, EVENT_DATABASE_URL } from './config';
import { parseEventsCsv } from './lib/csv';
import { filterEvents } from './lib/filter';
import { withCacheBuster } from './lib/urls';
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

function App() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [warnings, setWarnings] = useState<DataWarning[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [filters, setFilters] = useState<EventFilters>(INITIAL_FILTERS);
  const [viewDate, setViewDate] = useState(() => new Date());
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

  const loadEvents = useCallback(async () => {
    setLoadState('loading');
    setLoadError('');

    try {
      const response = await fetch(withCacheBuster(EVENT_DATABASE_URL), {
        cache: 'no-store',
        headers: { Accept: 'text/csv, text/plain;q=0.9' },
      });
      if (!response.ok) {
        throw new Error(`The event database returned HTTP ${response.status}.`);
      }

      const csv = await response.text();
      const parsed = parseEventsCsv(csv);
      setEvents(parsed.events);
      setWarnings(parsed.warnings);
      setUpdatedAt(new Date());
      setLoadState('success');
    } catch (error: unknown) {
      console.error('Unable to load AGT event database', error);
      setLoadError(
        error instanceof Error
          ? error.message
          : 'An unexpected database error occurred.',
      );
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const filteredEvents = useMemo(
    () => filterEvents(events, filters),
    [events, filters],
  );
  const skippedRows = warnings.filter((warning) =>
    warning.messages.some((message) =>
      /required|must|cannot|missing required|duplicate/i.test(message),
    ),
  ).length;

  const closeSelectedEvent = useCallback(() => setSelectedEvent(null), []);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to calendar
      </a>

      <header className="site-header">
        <div className="header-content">
          <div className="brand-lockup">
            <div className="agt-emblem" aria-hidden="true">
              <span>AGT</span>
            </div>
            <div>
              <p className="brand-name">Alliance of Galactic Travellers</p>
              <p className="product-name">AGT Event Calendar</p>
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
                  ? 'Syncing database'
                  : loadState === 'error'
                    ? 'Database offline'
                    : 'Database live'}
              </span>
            </div>
            <a
              className="bug-link"
              href={BUG_REPORT_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span aria-hidden="true">◇</span>
              Bug Report
            </a>
          </div>
        </div>
        <div className="header-divider" />
      </header>

      <main id="main-content" className="main-content">
        <section className="intro" aria-labelledby="page-heading">
          <p className="eyebrow">No Man's Sky community operations</p>
          <h1 id="page-heading">Events across the galaxies</h1>
          <p>
            Browse AGT gatherings in your local time. Select any event for its
            UTC schedule, host, portal address, destination, description, and
            related links.
          </p>
        </section>

        {loadState === 'loading' && (
          <section className="state-panel loading-panel" aria-live="polite">
            <div className="orbit-loader" aria-hidden="true">
              <span>AGT</span>
            </div>
            <div>
              <h2>Synchronizing the galactic archive</h2>
              <p>Fetching a fresh copy of the event database…</p>
            </div>
          </section>
        )}

        {loadState === 'error' && (
          <section className="state-panel error-panel" role="alert">
            <div>
              <p className="eyebrow">Database error</p>
              <h2>Events could not be loaded</h2>
              <p>{loadError}</p>
              <p>
                Check the connection and confirm that the configured CSV is
                published and permits browser access.
              </p>
            </div>
            <button className="button button-primary" type="button" onClick={loadEvents}>
              Retry sync
            </button>
          </section>
        )}

        {loadState === 'success' && (
          <>
            <section className="data-meta" aria-label="Database status">
              <div>
                <span className="data-count">{events.length}</span>
                <span>{events.length === 1 ? 'validated event' : 'validated events'}</span>
              </div>
              <div>
                <span className="data-count">{filteredEvents.length}</span>
                <span>matching filters</span>
              </div>
              <div className="sync-time">
                <span>Fresh sync</span>
                <time dateTime={updatedAt?.toISOString()}>
                  {updatedAt?.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </div>
              <button
                className="button button-secondary"
                type="button"
                onClick={loadEvents}
              >
                Refresh database
              </button>
            </section>

            {warnings.length > 0 && (
              <details className="warning-panel">
                <summary>
                  <span aria-hidden="true">!</span>
                  Database loaded with {warnings.length}{' '}
                  {warnings.length === 1 ? 'warning' : 'warnings'}
                  {skippedRows > 0 ? `; ${skippedRows} malformed rows skipped` : ''}
                </summary>
                <div className="warning-details">
                  <p>
                    Valid events remain available. Row numbers refer to the
                    source CSV and are shown for maintainers.
                  </p>
                  <ul>
                    {warnings.map((warning, index) => (
                      <li key={`${warning.row}-${index}`}>
                        <strong>Row {warning.row}:</strong>{' '}
                        {warning.messages.join('; ')}
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            )}

            <FilterBar events={events} filters={filters} onChange={setFilters} />

            {events.length === 0 ? (
              <section className="state-panel empty-panel">
                <div>
                  <p className="eyebrow">Archive empty</p>
                  <h2>No valid events are available</h2>
                  <p>
                    The CSV loaded successfully but contained no rows that met
                    the required event schema.
                  </p>
                </div>
              </section>
            ) : (
              <Calendar
                events={filteredEvents}
                viewDate={viewDate}
                onViewDateChange={setViewDate}
                onSelectEvent={setSelectedEvent}
              />
            )}
          </>
        )}
      </main>

      <footer className="site-footer">
        <p>
          Copyright {new Date().getFullYear()} Alliance of Galactic Travellers.
          All Rights Reserved.
        </p>
        <a href={BUG_REPORT_URL} target="_blank" rel="noopener noreferrer">
          Report an issue
        </a>
      </footer>

      <EventModal selectedEvent={selectedEvent} onClose={closeSelectedEvent} />
    </div>
  );
}

export default App;
