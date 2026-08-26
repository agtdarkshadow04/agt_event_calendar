const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export function buildGlyphToolUrl(galaxy: string, portalCode: string): string {
  const url = new URL('https://glyph.nms-agt.com/');
  url.searchParams.set('embed', 'false');
  url.searchParams.set('galaxy', galaxy);
  url.searchParams.set('glyphs', portalCode);
  return url.href;
}

export function safeExternalUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function markdownUrlTransform(value: string): string {
  return safeExternalUrl(value) ?? '';
}

export function withEventId(value: string, eventId: string | null): string {
  const url = new URL(value);
  if (eventId === null) {
    url.searchParams.delete('event_id');
  } else {
    url.searchParams.set('event_id', eventId);
  }
  return url.href;
}

export function withCacheBuster(value: string): string {
  const url = new URL(value, window.location.origin);
  url.searchParams.set('_agt_refresh', String(Date.now()));
  return url.href;
}

