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
import { formatTranslation, getTranslations } from '../translations';

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
  missingText = '',
}: {
  label: string;
  value: string | null;
  optional?: boolean;
  monospace?: boolean;
  missingText?: string;
}) {
  return (
    <div className="detail-field">
      <dt>{label}</dt>
      <dd className={monospace ? 'monospace' : undefined}>
        {value || (optional ? <span className="missing">{missingText}</span> : '—')}
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
  const translations = getTranslations(locale);
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
            <p className="eyebrow">
              {formatTranslation(translations.eventRecord, { id: event.id })}
            </p>
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
                ? translations.eventUrlCopied
                : shareState === 'error'
                  ? translations.copyUrlError
                  : ''}
            </span>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => void shareEvent()}
              disabled={shareState === 'copying'}
            >
              {translations.share}
            </button>
            <button
              ref={closeButtonRef}
              className="button button-icon modal-close"
              type="button"
              onClick={onClose}
              aria-label={translations.closeEventDetails}
            >
              <XIcon />
            </button>
          </div>
        </header>

        <div className="modal-scroll-region">
          <section className="cover-section" aria-label={translations.eventCoverImage}>
            {event.coverImageUrl && !coverFailed ? (
              <img
                src={event.coverImageUrl}
                alt={formatTranslation(translations.coverArtworkFor, {
                  name: event.name,
                })}
                onError={() => setCoverFailed(true)}
                referrerPolicy="no-referrer"
              />
            ) : (
              <div
                className="cover-fallback"
                role="img"
                aria-label={translations.noEventCover}
              >
                <span className="cover-mark" aria-hidden="true">AGT</span>
                <span>
                  {coverFailed
                    ? translations.coverLoadError
                    : translations.noCoverSupplied}
                </span>
              </div>
            )}
          </section>

          <section className="detail-section" aria-labelledby="schedule-heading">
            <h3 id="schedule-heading">{translations.schedule}</h3>
            <dl className="detail-grid schedule-grid">
              <DetailField
                label={translations.startLocal}
                value={formatLocal(event.start)}
              />
              <DetailField
                label={translations.startUtc}
                value={formatUtc(event.start)}
                monospace
              />
              <DetailField
                label={translations.endLocal}
                value={event.end ? formatLocal(event.end) : null}
                optional
                missingText={translations.notSupplied}
              />
              <DetailField
                label={translations.endUtc}
                value={event.end ? formatUtc(event.end) : null}
                optional
                monospace
                missingText={translations.notSupplied}
              />
            </dl>
          </section>

          <section className="detail-section" aria-labelledby="location-heading">
            <h3 id="location-heading">{translations.eventInformation}</h3>
            <dl className="detail-grid">
              <DetailField label={translations.eventId} value={event.id} monospace />
              <DetailField label={translations.eventType} value={event.type} />
              <DetailField
                label={translations.host}
                value={event.civilization}
                optional
                missingText={translations.notSupplied}
              />
              <DetailField label={translations.galaxy} value={event.galaxy} />
              <DetailField label={translations.region} value={event.region} />
              <DetailField label={translations.system} value={event.system} />
              <DetailField
                label={translations.planet}
                value={event.planet}
                optional
                missingText={translations.notSupplied}
              />
              <div className="detail-field">
                <dt>{translations.portalCode}</dt>
                <dd className="monospace portal-code">
                  <span className="portal-code-value">{event.portalCode}</span>
                  <a
                    className="portal-link"
                    href={glyphToolUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={translations.openGlyphTool}
                    aria-label={translations.openGlyphTool}
                  >
                    <ExternalLinkIcon />
                  </a>
                </dd>
              </div>
            </dl>
          </section>

          <section className="detail-section" aria-labelledby="description-heading">
            <h3 id="description-heading">{translations.description}</h3>
            {!event.descriptionUrl && (
              <p className="empty-note">{translations.noMarkdownDescription}</p>
            )}
            {descriptionState === 'loading' && (
              <p className="loading-note" role="status">
                {translations.loadingRemoteDescription}
              </p>
            )}
            {descriptionState === 'error' && (
              <p className="error-note" role="alert">
                {translations.remoteDescriptionError}
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
            <h3 id="links-heading">{translations.relatedLinks}</h3>
            {event.links.length === 0 ? (
              <p className="empty-note">{translations.noRelatedLinks}</p>
            ) : (
              <ul className="related-links">
                {event.links.map((link, index) => (
                  <li key={link}>
                    <a href={link} target="_blank" rel="noopener noreferrer">
                      {formatTranslation(translations.linkLabel, {
                        number: index + 1,
                      })}
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
