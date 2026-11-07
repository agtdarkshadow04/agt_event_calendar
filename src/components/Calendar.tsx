import { useMemo } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from './Icons';
import {
  dateAtUtcOffset,
  eventDayPosition,
  eventOccursOnLocalDay,
  formatAtUtcOffset,
  formatMonthInput,
  getMonthGrid,
  isSameLocalDay,
  parseMonthInput,
} from '../lib/date';
import type { CalendarEvent } from '../types';
import { formatTranslation, getTranslations } from '../translations';

interface CalendarProps {
  events: CalendarEvent[];
  viewDate: Date;
  locale: string;
  timeZone: string;
  timeZoneOffset: number;
  onViewDateChange: (date: Date) => void;
  onSelectEvent: (event: CalendarEvent) => void;
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function positionLabel(
  position: ReturnType<typeof eventDayPosition>,
  translations: ReturnType<typeof getTranslations>,
): string {
  if (position === 'start') return translations.starts;
  if (position === 'middle') return translations.continues;
  if (position === 'end') return translations.ends;
  return '';
}

export function Calendar({
  events,
  viewDate,
  locale,
  timeZone,
  timeZoneOffset,
  onViewDateChange,
  onSelectEvent,
}: CalendarProps) {
  const translations = getTranslations(locale);
  const today = dateAtUtcOffset(new Date(), timeZoneOffset);
  const days = useMemo(() => getMonthGrid(viewDate), [viewDate]);
  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }),
    [locale],
  );
  const dayLabelFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }),
    [locale],
  );
  const weekdays = useMemo(() => {
    const longFormatter = new Intl.DateTimeFormat(locale, { weekday: 'long' });
    const shortFormatter = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(2024, 0, 7 + index);
      return [longFormatter.format(day), shortFormatter.format(day)];
    });
  }, [locale]);
  const visibleMonthEvents = events.filter((event) =>
    days.some((day) => eventOccursOnLocalDay(event, day, timeZoneOffset)),
  );
  const formatTime = (date: Date) =>
    formatAtUtcOffset(date, locale, timeZoneOffset, {
      hour: 'numeric',
      minute: '2-digit',
    });

  const moveMonth = (delta: number) => {
    onViewDateChange(
      new Date(viewDate.getFullYear(), viewDate.getMonth() + delta, 1),
    );
  };

  return (
    <section className="calendar-shell" aria-labelledby="calendar-heading">
      <div className="calendar-toolbar">
        <div>
          <p className="eyebrow">
            {formatTranslation(translations.viewerLocalTime, { timeZone })}
          </p>
          <h2 id="calendar-heading" aria-live="polite">
            {monthFormatter.format(viewDate)}
          </h2>
        </div>

        <div className="calendar-actions" aria-label={translations.calendarNavigation}>
          <button
            className="button button-icon"
            type="button"
            onClick={() => moveMonth(-1)}
            aria-label={translations.previousMonth}
          >
            <ChevronLeftIcon />
          </button>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => onViewDateChange(new Date())}
          >
            {translations.today}
          </button>
          <button
            className="button button-icon"
            type="button"
            onClick={() => moveMonth(1)}
            aria-label={translations.nextMonth}
          >
            <ChevronRightIcon />
          </button>
          <label className="month-picker">
            <span className="sr-only">{translations.goToMonth}</span>
            <input
              type="month"
              value={formatMonthInput(viewDate)}
              onChange={(changeEvent) => {
                const parsed = parseMonthInput(changeEvent.target.value);
                if (parsed) onViewDateChange(parsed);
              }}
            />
          </label>
        </div>
      </div>

      <p className="calendar-summary" aria-live="polite">
        {visibleMonthEvents.length === 0
          ? translations.noMatchingEvents
          : formatTranslation(
              visibleMonthEvents.length === 1
                ? translations.matchingEventSummary
                : translations.matchingEventsSummary,
              { count: visibleMonthEvents.length },
            )}
      </p>

      <div className="calendar-grid" role="grid" aria-label={translations.eventCalendar}>
        {weekdays.map(([full, short]) => (
          <div className="weekday" role="columnheader" key={full}>
            <span className="weekday-full">{full}</span>
            <span className="weekday-short" aria-hidden="true">
              {short}
            </span>
          </div>
        ))}

        {days.map((day) => {
          const dayEvents = events.filter((event) =>
            eventOccursOnLocalDay(event, day, timeZoneOffset),
          );
          const outsideMonth = day.getMonth() !== viewDate.getMonth();
          const isToday = isSameLocalDay(day, today);

          return (
            <div
              className={`calendar-day${outsideMonth ? ' outside-month' : ''}${
                isToday ? ' current-day' : ''
              }`}
              role="gridcell"
              aria-label={dayLabelFormatter.format(day)}
              key={localDateKey(day)}
            >
              <div className="day-number-row">
                <time dateTime={localDateKey(day)}>
                  {day.getDate()}
                </time>
                {isToday && (
                  <span className="today-label">{translations.today}</span>
                )}
              </div>

              <div className="day-events">
                {dayEvents.map((event) => {
                  const position = eventDayPosition(event, day, timeZoneOffset);
                  const context = positionLabel(position, translations);
                  const showTime = position === 'single' || position === 'start';

                  return (
                    <button
                      type="button"
                      className="event-chip"
                      data-position={position}
                      key={`${event.id}-${localDateKey(day)}`}
                      onClick={() => onSelectEvent(event)}
                      aria-label={formatTranslation(
                        showTime
                          ? translations.eventDetailsAtTime
                          : translations.eventDetails,
                        {
                          name: event.name,
                          context: context || translations.event,
                          time: formatTime(event.start),
                        },
                      )}
                    >
                      <span className="event-chip-time">
                        {context || formatTime(event.start)}
                      </span>
                      <span className="event-chip-name">{event.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
