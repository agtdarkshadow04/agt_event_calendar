import { uniqueSorted } from '../lib/filter';
import type { CalendarEvent, EventFilters } from '../types';
import { formatTranslation, getTranslations } from '../translations';
import type { Locale } from '../translations';

interface FilterBarProps {
  events: CalendarEvent[];
  filters: EventFilters;
  locale: Locale;
  onChange: (filters: EventFilters) => void;
}

const EMPTY_FILTERS: EventFilters = {
  search: '',
  type: '',
  civilization: '',
  galaxy: '',
  dateContext: 'all',
};

export function FilterBar({ events, filters, locale, onChange }: FilterBarProps) {
  const translations = getTranslations(locale);
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
          <p className="eyebrow">{translations.archiveControls}</p>
          <h2 id="filters-heading">{translations.filterEvents}</h2>
        </div>
        <button
          className="button button-secondary clear-button"
          type="button"
          disabled={activeCount === 0}
          onClick={() => onChange(EMPTY_FILTERS)}
        >
          {activeCount > 0
            ? formatTranslation(translations.clearAllCount, {
                count: activeCount,
              })
            : translations.clearAll}
        </button>
      </div>

      <div className="filter-grid">
        <label className="field search-field">
          <span>{translations.search}</span>
          <input
            type="search"
            value={filters.search}
            onChange={(changeEvent) => set('search', changeEvent.target.value)}
            placeholder={translations.searchPlaceholder}
          />
        </label>

        <label className="field">
          <span>{translations.eventType}</span>
          <select
            value={filters.type}
            onChange={(changeEvent) => set('type', changeEvent.target.value)}
          >
            <option value="">{translations.allEventTypes}</option>
            {eventTypes.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>{translations.host}</span>
          <select
            value={filters.civilization}
            onChange={(changeEvent) =>
              set('civilization', changeEvent.target.value)
            }
          >
            <option value="">{translations.allHosts}</option>
            {civilizations.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>{translations.galaxy}</span>
          <select
            value={filters.galaxy}
            onChange={(changeEvent) => set('galaxy', changeEvent.target.value)}
          >
            <option value="">{translations.allGalaxies}</option>
            {galaxies.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>{translations.dateContext}</span>
          <select
            value={filters.dateContext}
            onChange={(changeEvent) =>
              set(
                'dateContext',
                changeEvent.target.value as EventFilters['dateContext'],
              )
            }
          >
            <option value="all">{translations.allDates}</option>
            <option value="upcoming">{translations.upcomingOnly}</option>
            <option value="next30">{translations.next30Days}</option>
          </select>
        </label>
      </div>
    </section>
  );
}
