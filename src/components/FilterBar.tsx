import { uniqueSorted } from '../lib/filter';
import type { CalendarEvent, EventFilters } from '../types';

interface FilterBarProps {
  events: CalendarEvent[];
  filters: EventFilters;
  onChange: (filters: EventFilters) => void;
}

const EMPTY_FILTERS: EventFilters = {
  search: '',
  type: '',
  civilization: '',
  galaxy: '',
  dateContext: 'all',
};

export function FilterBar({ events, filters, onChange }: FilterBarProps) {
  const eventTypes = uniqueSorted(events.map((event) => event.type));
  const civilizations = uniqueSorted(
    events.map((event) => event.civilization),
  );
  const galaxies = uniqueSorted(events.map((event) => event.galaxy));
  const activeCount = [
    filters.search,
    filters.type,
    filters.civilization,
    filters.galaxy,
    filters.dateContext === 'all' ? '' : filters.dateContext,
  ].filter(Boolean).length;

  const set = <K extends keyof EventFilters>(
    key: K,
    value: EventFilters[K],
  ) => onChange({ ...filters, [key]: value });

  return (
    <section className="filter-panel" aria-labelledby="filters-heading">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Galactic archive controls</p>
          <h2 id="filters-heading">Filter events</h2>
        </div>
        <button
          className="button button-secondary clear-button"
          type="button"
          disabled={activeCount === 0}
          onClick={() => onChange(EMPTY_FILTERS)}
        >
          Clear all{activeCount > 0 ? ` (${activeCount})` : ''}
        </button>
      </div>

      <div className="filter-grid">
        <label className="field search-field">
          <span>Search</span>
          <input
            type="search"
            value={filters.search}
            onChange={(changeEvent) => set('search', changeEvent.target.value)}
            placeholder="Name, ID, location, portal code…"
          />
        </label>

        <label className="field">
          <span>Event type</span>
          <select
            value={filters.type}
            onChange={(changeEvent) => set('type', changeEvent.target.value)}
          >
            <option value="">All event types</option>
            {eventTypes.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Host</span>
          <select
            value={filters.civilization}
            onChange={(changeEvent) =>
              set('civilization', changeEvent.target.value)
            }
          >
            <option value="">All hosts</option>
            {civilizations.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Galaxy</span>
          <select
            value={filters.galaxy}
            onChange={(changeEvent) => set('galaxy', changeEvent.target.value)}
          >
            <option value="">All galaxies</option>
            {galaxies.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Date context</span>
          <select
            value={filters.dateContext}
            onChange={(changeEvent) =>
              set(
                'dateContext',
                changeEvent.target.value as EventFilters['dateContext'],
              )
            }
          >
            <option value="all">All dates</option>
            <option value="upcoming">Upcoming only</option>
            <option value="next30">Next 30 days</option>
          </select>
        </label>
      </div>
    </section>
  );
}

