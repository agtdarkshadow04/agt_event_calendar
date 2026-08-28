import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ExternalLinkIcon, XIcon } from './Icons';
import { formatAtUtcOffset } from '../lib/date';
import {
  buildGlyphToolUrl,
  markdownUrlTransform,
  safeExternalUrl,
  withCacheBuster,
  withEventId,
} from '../lib/urls';
import type { CalendarEvent } from '../types';

interface EventModalProps {
  selectedEvent: CalendarEvent | null;
  locale: string;
  timeZone: string;
  timeZoneOffset: number;
  onClose: () => void;
}

function DetailField({
  label,
  value,
  optional = false,
  monospace = false,
}: {
  label: string;
  value: string | null;
  optional?: boolean;
  monospace?: boolean;
}) {
  return (
    <div className="detail-field">
      <dt>{label}</dt>
      <dd className={monospace ? 'monospace' : undefined}>
        {value || (optional ? <span className="missing">Not supplied</span> : '—')}
      </dd>
    </div>
  );
}

function formatUtc(date: Date): string {
  return `${date.toISOString().replace('T', ' ').replace('.000Z', 'Z')} (UTC)`;
}

export function EventModal({
  selectedEvent,
  locale,
  timeZone,
  timeZoneOffset,
  onClose,
}: EventModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [description, setDescription] = useState('');
  const [descriptionState, setDescriptionState] = useState<
    'idle' | 'loading' | 'loaded' | 'error'
  >('idle');
  const [coverFailed, setCoverFailed] = useState(false);
  const [shareState, setShareState] = useState<
    'idle' | 'copying' | 'copied' | 'error'
  >('idle');

  useEffect(() => {
    if (!selectedEvent) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') {
        keyEvent.preventDefault();
        onClose();
        return;
      }

      if (keyEvent.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (keyEvent.shiftKey && document.activeElement === first) {
        keyEvent.preventDefault();
        last.focus();
      } else if (!keyEvent.shiftKey && document.activeElement === last) {
        keyEvent.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [selectedEvent, onClose]);

  useEffect(() => {
    setDescription('');
    setDescriptionState('idle');
    setCoverFailed(false);
    setShareState('idle');
    if (!selectedEvent?.descriptionUrl) return;

    const controller = new AbortController();
    setDescriptionState('loading');
    fetch(withCacheBuster(selectedEvent.descriptionUrl), {
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'text/markdown, text/plain;q=0.9' },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Description request failed (${response.status})`);
        }
        return response.text();
      })
      .then((text) => {
        setDescription(text);
        setDescriptionState('loaded');
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        console.error('Unable to load event description', error);
        setDescriptionState('error');
      });

    return () => controller.abort();
  }, [selectedEvent]);

  if (!selectedEvent) return null;

  const event = selectedEvent;
  const formatLocal = (date: Date) =>
    `${formatAtUtcOffset(date, locale, timeZoneOffset, {
      dateStyle: 'full',
      timeStyle: 'medium',
    })} (${timeZone})`;
  const glyphToolUrl = buildGlyphToolUrl(event.galaxy, event.portalCode);
  const shareEvent = async () => {
    setShareState('copying');
    try {
      await navigator.clipboard.writeText(
        withEventId(window.location.href, event.id),
      );
      setShareState('copied');
    } catch (error: unknown) {
      console.error('Unable to copy event URL', error);
      setShareState('error');
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
        className="event-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-dialog-title"
        aria-describedby="event-dialog-summary"
        ref={dialogRef}
      >
        <header className="modal-header">
          <div>
            <p className="eyebrow">Event record · {event.id}</p>
            <h2 id="event-dialog-title">{event.name}</h2>
            <p id="event-dialog-summary" className="modal-subtitle">
              {event.type} · {event.galaxy}
            </p>
          </div>
          <div className="modal-header-actions">
            <span
              className={`modal-share-status${shareState === 'error' ? ' error-note' : ''}`}
              role={shareState === 'error' ? 'alert' : 'status'}
              aria-live="polite"
            >
              {shareState === 'copied'
                ? 'Event URL copied'
                : shareState === 'error'
                  ? 'Unable to copy URL'
                  : ''}
            </span>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => void shareEvent()}
              disabled={shareState === 'copying'}
            >
              Share
            </button>
            <button
              ref={closeButtonRef}
              className="button button-icon modal-close"
              type="button"
              onClick={onClose}
              aria-label="Close event details"
            >
              <XIcon />
            </button>
          </div>
        </header>

        <div className="modal-scroll-region">
          <section className="cover-section" aria-label="Event cover image">
            {event.coverImageUrl && !coverFailed ? (
              <img
                src={event.coverImageUrl}
                alt={`Cover artwork for ${event.name}`}
                onError={() => setCoverFailed(true)}
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="cover-fallback" role="img" aria-label="No event cover available">
                <span className="cover-mark" aria-hidden="true">AGT</span>
                <span>
                  {coverFailed
                    ? 'Cover image could not be loaded'
                    : 'No cover image supplied'}
                </span>
              </div>
            )}
          </section>

          <section className="detail-section" aria-labelledby="schedule-heading">
            <h3 id="schedule-heading">Schedule</h3>
            <dl className="detail-grid schedule-grid">
              <DetailField label="Start · local" value={formatLocal(event.start)} />
              <DetailField label="Start · UTC" value={formatUtc(event.start)} monospace />
              <DetailField
                label="End · local"
                value={event.end ? formatLocal(event.end) : null}
                optional
              />
              <DetailField
                label="End · UTC"
                value={event.end ? formatUtc(event.end) : null}
                optional
                monospace
              />
            </dl>
          </section>

          <section className="detail-section" aria-labelledby="location-heading">
            <h3 id="location-heading">Event information</h3>
            <dl className="detail-grid">
              <DetailField label="Event ID" value={event.id} monospace />
              <DetailField label="Event type" value={event.type} />
              <DetailField label="Host" value={event.civilization} optional />
              <DetailField label="Galaxy" value={event.galaxy} />
              <DetailField label="Region" value={event.region} />
              <DetailField label="System" value={event.system} />
              <DetailField label="Planet" value={event.planet} optional />
              <div className="detail-field">
                <dt>Portal code</dt>
                <dd className="monospace portal-code">
                  <span className="portal-code-value">{event.portalCode}</span>
                  <a
                    className="portal-link"
                    href={glyphToolUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open with Glyph Tool"
                    aria-label="Open with Glyph Tool"
                  >
                    <ExternalLinkIcon />
                  </a>
                </dd>
              </div>
            </dl>
          </section>

          <section className="detail-section" aria-labelledby="description-heading">
            <h3 id="description-heading">Description</h3>
            {!event.descriptionUrl && (
              <p className="empty-note">No Markdown description supplied.</p>
            )}
            {descriptionState === 'loading' && (
              <p className="loading-note" role="status">
                Loading remote description…
              </p>
            )}
            {descriptionState === 'error' && (
              <p className="error-note" role="alert">
                The remote description could not be loaded. Event details above
                are still available.
              </p>
            )}
            {descriptionState === 'loaded' && (
              <div className="markdown-body">
                <ReactMarkdown
                  skipHtml
                  urlTransform={markdownUrlTransform}
                  components={{
                    a: ({ href, children }) => {
                      const safe = href ? safeExternalUrl(href) : null;
                      return safe ? (
                        <a href={safe} target="_blank" rel="noopener noreferrer">
                          {children}
                        </a>
                      ) : (
                        <span>{children}</span>
                      );
                    },
                    img: () => null,
                  }}
                >
                  {description}
                </ReactMarkdown>
              </div>
            )}
          </section>

          <section className="detail-section" aria-labelledby="links-heading">
            <h3 id="links-heading">Related links</h3>
            {event.links.length === 0 ? (
              <p className="empty-note">No related links supplied.</p>
            ) : (
              <ul className="related-links">
                {event.links.map((link, index) => (
                  <li key={link}>
                    <a href={link} target="_blank" rel="noopener noreferrer">
                      Link {index + 1}
                      <span aria-hidden="true"> ↗</span>
                      <span className="link-host">{new URL(link).hostname}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

