import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { EMPTY_EVENT_FORM, EventFormFields, eventFormFromApi, eventPayload } from '../components/EventFormFields';
import type { EventFormState } from '../components/EventFormFields';
import { Markdown } from '../components/Markdown';
import { imageUrl } from '../lib/api';
import type { AdminApiEvent } from '../lib/api';
import { ApiError, apiRequest } from '../lib/client';
import { EVENT_STATUSES, validateEventInput } from '../lib/validation';
import type { EventStatus, FieldError } from '../lib/validation';
import { errorMessage, useAdmin } from './context';
import type { AdminTranslations } from './i18n';

interface ImageSummary { id: string; mimeType: string; sizeBytes: number }

export function statusLabel(t: AdminTranslations, status: EventStatus): string {
  return { published: t.statusPublished, unpublished: t.statusUnpublished, pending: t.statusPending, rejected: t.statusRejected }[status];
}

function EventEditor({ event, onSaved, onCancel }: { event: AdminApiEvent | null; onSaved: () => void; onCancel: () => void }) {
  const admin = useAdmin();
  const { t, pt, timeZone, timeZoneOffset } = admin;
  const [form, setForm] = useState<EventFormState>(event ? eventFormFromApi(event, timeZoneOffset) : EMPTY_EVENT_FORM);
  const [status, setStatus] = useState<EventStatus>(event?.status ?? 'unpublished');
  const [coverImageId, setCoverImageId] = useState<string>(event?.coverImageId ?? '');
  const [images, setImages] = useState<ImageSummary[]>([]);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiRequest<ImageSummary[]>('/api/admin/images').then(setImages).catch(() => setImages([]));
  }, []);

  const upload = async (file: File) => {
    const body = new FormData();
    body.set('file', file, file.name);
    try {
      const { image } = await apiRequest<{ image: ImageSummary }>('/api/admin/images', { method: 'POST', body });
      setImages((current) => [image, ...current]);
      setCoverImageId(image.id);
      setMessage('');
    } catch (error) {
      setMessage(errorMessage(error, admin));
    }
  };

  const save = async (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    const payload = { ...eventPayload(form, timeZoneOffset), status, coverImageId: coverImageId || null };
    const checked = validateEventInput(payload, pt);
    if (!checked.ok) {
      setErrors(checked.errors);
      setMessage(pt.checkHighlightedFields);
      return;
    }
    setBusy(true);
    try {
      await apiRequest(event ? `/api/admin/events/${event.id}` : '/api/admin/events', {
        method: event ? 'PUT' : 'POST',
        json: payload,
      });
      onSaved();
    } catch (error) {
      if (error instanceof ApiError && error.fields) setErrors(error.fields);
      setMessage(errorMessage(error, admin));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="admin-panel admin-form" onSubmit={(submit) => void save(submit)} noValidate>
      <h3>{event ? `${t.edit}: ${event.name}` : t.newEvent}</h3>
      {event?.submitterAgtUsername && <p>{t.submittedBy}: <strong>{event.submitterAgtUsername}</strong></p>}
      {event?.legacyId && <p>{t.legacyId}: <code>{event.legacyId}</code></p>}
      <EventFormFields value={form} onChange={setForm} errors={errors} translations={pt} timeZone={timeZone} timeZoneOffset={timeZoneOffset} />
      <div className="form-grid">
        <label className="field">
          <span>{t.status}</span>
          <select value={status} onChange={(change) => setStatus(change.target.value as EventStatus)}>
            {EVENT_STATUSES.map((value) => <option key={value} value={value}>{statusLabel(t, value)}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{pt.coverImage}</span>
          <select value={coverImageId} onChange={(change) => setCoverImageId(change.target.value)}>
            <option value="">{t.noCover}</option>
            {images.map((image) => <option key={image.id} value={image.id}>{image.id.slice(0, 8)} · {image.mimeType} · {Math.round(image.sizeBytes / 1024)} KB</option>)}
          </select>
        </label>
        <label className="field">
          <span>{t.uploadImage}</span>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(change) => { const file = change.target.files?.[0]; if (file) void upload(file); }} />
        </label>
        {coverImageId && <img className="markdown-image" src={imageUrl(coverImageId)} alt="" />}
      </div>
      {form.description && (
        <details>
          <summary>{t.previewDescription}</summary>
          <Markdown imageAlt={pt.externalImageAlt}>{form.description}</Markdown>
        </details>
      )}
      {message && <p className="error-note" role="alert">{message}</p>}
      <div className="admin-row-actions">
        <button className="button button-primary" type="submit" disabled={busy}>{t.save}</button>
        <button className="button button-secondary" type="button" onClick={onCancel}>{t.cancel}</button>
      </div>
    </form>
  );
}

export function EventsPanel({ moderation, onChanged }: { moderation: boolean; onChanged: () => void }) {
  const admin = useAdmin();
  const { t, locale } = admin;
  const [events, setEvents] = useState<AdminApiEvent[]>([]);
  const [filter, setFilter] = useState<EventStatus | ''>(moderation ? 'pending' : '');
  const [editing, setEditing] = useState<AdminApiEvent | 'new' | null>(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      const query = moderation ? '?status=pending' : filter ? `?status=${filter}` : '';
      setEvents(await apiRequest<AdminApiEvent[]>(`/api/admin/events${query}`));
      setMessage('');
    } catch (error) {
      setMessage(errorMessage(error, admin));
    }
  }, [filter, moderation]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: () => Promise<unknown>) => {
    try {
      await action();
      await load();
      onChanged();
    } catch (error) {
      setMessage(errorMessage(error, admin));
    }
  };
  const setStatus = (event: AdminApiEvent, status: EventStatus) =>
    act(() => apiRequest(`/api/admin/events/${event.id}/status`, { method: 'POST', json: { status } }));
  const remove = (event: AdminApiEvent) => {
    if (window.confirm(t.confirmDelete)) void act(() => apiRequest(`/api/admin/events/${event.id}`, { method: 'DELETE' }));
  };
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });

  if (editing) {
    return (
      <EventEditor
        event={editing === 'new' ? null : editing}
        onCancel={() => setEditing(null)}
        onSaved={() => { setEditing(null); void load(); onChanged(); }}
      />
    );
  }

  return (
    <section className="admin-panel" aria-labelledby="events-title">
      <h2 id="events-title">{moderation ? t.tabModeration : t.tabEvents}</h2>
      {moderation && <p>{t.moderationIntro}</p>}
      <div className="admin-toolbar">
        {!moderation && (
          <>
            <label className="field">
              <span>{t.status}</span>
              <select value={filter} onChange={(change) => setFilter(change.target.value as EventStatus | '')}>
                <option value="">{t.allStatuses}</option>
                {EVENT_STATUSES.map((value) => <option key={value} value={value}>{statusLabel(t, value)}</option>)}
              </select>
            </label>
            <button className="button button-primary" type="button" onClick={() => setEditing('new')}>{t.newEvent}</button>
          </>
        )}
      </div>
      {message && <p className="error-note" role="alert">{message}</p>}
      {events.length === 0 ? (
        <p className="empty-note">{t.noItems}</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t.name}</th>
                <th>{t.start}</th>
                <th>{t.status}</th>
                {moderation ? <th>{t.submittedBy}</th> : <th>{t.legacyId}</th>}
                <th>{t.actions}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>
                    <strong>{event.name}</strong>
                    <br />
                    <small className="field-help">{event.type} · {event.galaxy}</small>
                  </td>
                  <td>{dateFormat.format(new Date(event.start))}</td>
                  <td><span className={`status-pill ${event.status}`}>{statusLabel(t, event.status)}</span></td>
                  <td>{moderation ? event.submitterAgtUsername : event.legacyId ?? '—'}</td>
                  <td>
                    <div className="admin-row-actions">
                      {event.status === 'pending' ? (
                        <>
                          <button className="button button-primary" type="button" onClick={() => void setStatus(event, 'published')}>{t.approve}</button>
                          <button className="button button-secondary" type="button" onClick={() => void setStatus(event, 'rejected')}>{t.reject}</button>
                        </>
                      ) : event.status === 'published' ? (
                        <button className="button button-secondary" type="button" onClick={() => void setStatus(event, 'unpublished')}>{t.unpublish}</button>
                      ) : (
                        <button className="button button-secondary" type="button" onClick={() => void setStatus(event, 'published')}>{t.publish}</button>
                      )}
                      <button className="button button-secondary" type="button" onClick={() => setEditing(event)}>{t.edit}</button>
                      <button className="button button-secondary" type="button" onClick={() => remove(event)}>{t.delete}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
