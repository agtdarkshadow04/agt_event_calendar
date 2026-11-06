export interface CalendarEvent {
  /** RFC 9562 UUIDv4. */
  id: string;
  /** Amplify-era 4-hex ID, kept only to resolve old bookmarks and links. */
  legacyId: string | null;
  name: string;
  start: Date;
  end: Date | null;
  civilization: string | null;
  type: string;
  /** Markdown, rendered without raw HTML. */
  description: string | null;
  coverImageUrl: string | null;
  links: string[];
  galaxy: string;
  region: string;
  system: string;
  planet: string | null;
  portalCode: string;
}

export interface EventFilters {
  search: string;
  type: string;
  civilization: string;
  galaxy: string;
  dateContext: 'all' | 'upcoming' | 'next30';
}
