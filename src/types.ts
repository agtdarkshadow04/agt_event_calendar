export interface CalendarEvent {
  id: string;
  name: string;
  start: Date;
  end: Date | null;
  civilization: string | null;
  type: string;
  descriptionUrl: string | null;
  coverImageUrl: string | null;
  links: string[];
  galaxy: string;
  region: string;
  system: string;
  planet: string | null;
  portalCode: string;
}

export interface DataWarning {
  row: number;
  messages: string[];
}

export interface ParseEventsResult {
  events: CalendarEvent[];
  warnings: DataWarning[];
}

export interface EventFilters {
  search: string;
  type: string;
  civilization: string;
  galaxy: string;
  dateContext: 'all' | 'upcoming' | 'next30';
}

