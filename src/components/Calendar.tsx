import { useMemo } from 'react';
import {
  eventDayPosition,
  eventOccursOnLocalDay,
  formatMonthInput,
  getMonthGrid,
  isSameLocalDay,
  parseMonthInput,
} from '../lib/date';
import type { CalendarEvent } from '../types';

interface CalendarProps {
  events: CalendarEvent[];
  viewDate: Date;
  onViewDateChange: (date: Date) => void;
  onSelectEvent: (event: CalendarEvent) => void;
}

const WEEKDAYS = [
  ['Sunday', 'Sun'],
  ['Monday', 'Mon'],
  ['Tuesday', 'Tue'],
  ['Wednesday', 'Wed'],
  ['Thursday', 'Thu'],
  ['Friday', 'Fri'],
  ['Saturday', 'Sat'],
];

const monthFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
});

const dayLabelFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function positionLabel(position: ReturnType<typeof eventDayPosition>): string {
  if (position === 'start') return 'Starts';
  if (position === 'middle') return 'Continues';
  if (position === 'end') return 'Ends';
  return '';
}

export function Calendar({
  events,
  viewDate,
  onViewDateChange,
  onSelectEvent,
}: CalendarProps) {
  const today = new Date();
  const days = useMemo(() => getMonthGrid(viewDate), [viewDate]);
  const visibleMonthEvents = events.filter((event) =>
    days.some((day) => eventOccursOnLocalDay(event, day)),
  );

  const moveMonth = (delta: number) => {
    onViewDateChange(
      new Date(viewDate.getFullYear(), viewDate.getMonth() + delta, 1),
    );
  };

  return (
    <section className="calendar-shell" aria-labelledby="calendar-heading">
      <div className="calendar-toolbar">
        <div>
          <p className="eyebrow">Viewer local time</p>
          <h2 id="calendar-heading" aria-live="polite">
            {monthFormatter.format(viewDate)}
          </h2>
        </div>

        <div className="calendar-actions" aria-label="Calendar navigation">
          <button
            className="button button-icon"
            type="button"
            onClick={() => moveMonth(-1)}
            aria-label="Previous month"
          >
            <span aria-hidden="true">‹</span>
          </button>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => onViewDateChange(new Date())}
          >
            Today
          </button>
          <button
            className="button button-icon"
            type="button"
            onClick={() => moveMonth(1)}
            aria-label="Next month"
          >
            <span aria-hidden="true">›</span>
          </button>
          <label className="month-picker">
            <span className="sr-only">Go to month</span>
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
          ? 'No matching events intersect this calendar view.'
          : `${visibleMonthEvents.length} matching ${
              visibleMonthEvents.length === 1 ? 'event' : 'events'
            } intersect this calendar view.`}
      </p>

      <div className="calendar-grid" role="grid" aria-label="Event calendar">
        {WEEKDAYS.map(([full, short]) => (
          <div className="weekday" role="columnheader" key={full}>
            <span className="weekday-full">{full}</span>
            <span className="weekday-short" aria-hidden="true">
              {short}
            </span>
          </div>
        ))}

        {days.map((day) => {
          const dayEvents = events.filter((event) =>
            eventOccursOnLocalDay(event, day),
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
                {isToday && <span className="today-label">Today</span>}
              </div>

              <div className="day-events">
                {dayEvents.map((event) => {
                  const position = eventDayPosition(event, day);
                  const context = positionLabel(position);
                  const showTime = position === 'single' || position === 'start';

                  return (
                    <button
                      type="button"
                      className="event-chip"
                      data-position={position}
                      key={`${event.id}-${localDateKey(day)}`}
                      onClick={() => onSelectEvent(event)}
                      aria-label={`${event.name}. ${context || 'Event'}${
                        showTime ? ` at ${timeFormatter.format(event.start)}` : ''
                      }. Open details.`}
                    >
                      <span className="event-chip-time">
                        {context || timeFormatter.format(event.start)}
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
