import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import './altcha';
import { altchaLanguage } from './altcha';
import { EMPTY_EVENT_FORM, EventFormFields, eventPayload } from './EventFormFields';
import type { EventFormState } from './EventFormFields';
import { PlusIcon, XIcon } from './Icons';
import { useDialog } from './useDialog';
import { ApiError, apiRequest } from '../lib/client';
import { LIMITS, validateAgtUsername, validateEventInput } from '../lib/validation';
import type { FieldError } from '../lib/validation';
import { formatTranslation, getTranslations } from '../translations';

interface SubmitEventModalProps {
  locale: string;
  timeZone: string;
  timeZoneOffset: number;
  submissionsEnabled: boolean;
  maxImageBytes: number;
  onClose: () => void;
}

const megabytes = (bytes: number) => Number((bytes / 1024 / 1024).toFixed(1));

export default function SubmitEventModal({
  locale, timeZone, timeZoneOffset, submissionsEnabled, maxImageBytes, onClose,
}: SubmitEventModalProps) {
  const translations = getTranslations(locale);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [form, setForm] = useState<EventFormState>(EMPTY_EVENT_FORM);
  const [username, setUsername] = useState('');
  const [cover, setCover] = useState<File | null>(null);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [state, setState] = useState<{ kind: 'idle' | 'submitting' | 'success' | 'error'; message: string }>({ kind: 'idle', message: '' });
  useDialog(dialogRef, closeButtonRef, onClose);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload = eventPayload(form, timeZoneOffset);
    const checked = validateEventInput(payload, translations);
    const user = validateAgtUsername(username, translations);
    const fieldErrors = [...(checked.ok ? [] : checked.errors), ...(user.ok ? [] : user.errors)];
    if (cover && cover.size > maxImageBytes) {
      fieldErrors.push({ field: 'cover', message: formatTranslation(translations.imageTooLarge, { size: megabytes(maxImageBytes) }) });
    }
    setErrors(fieldErrors);
    if (fieldErrors.length > 0) {
      setState({ kind: 'error', message: translations.checkHighlightedFields });
      return;
    }
    const altcha = new FormData(event.currentTarget).get('altcha');
    if (typeof altcha !== 'string' || !altcha) {
      setState({ kind: 'error', message: translations.captchaRequired });
      return;
    }

    const body = new FormData();
    body.set('event', JSON.stringify(payload));
    body.set('agtUsername', username);
    body.set('altcha', altcha);
    if (cover) body.set('cover', cover, cover.name);
    setState({ kind: 'submitting', message: '' });
    try {
      await apiRequest('/api/submissions', { method: 'POST', body, csrf: false });
      setState({ kind: 'success', message: translations.submissionSuccess });
      setForm(EMPTY_EVENT_FORM);
      setCover(null);
      formRef.current?.reset();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof ApiError && error.fields) setErrors(error.fields);
      setState({ kind: 'error', message: formatTranslation(translations.submissionFailed, { message }) });
      const widget = formRef.current?.querySelector('altcha-widget') as (HTMLElement & { reset?: () => void }) | null;
      widget?.reset?.();
    }
  };

  const usernameError = errors.filter((error) => error.field === 'agtUsername').map((error) => error.message).join(' ');
  const coverError = errors.filter((error) => error.field === 'cover').map((error) => error.message).join(' ');

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(mouseEvent) => {
        if (mouseEvent.target === mouseEvent.currentTarget) onClose();
      }}
    >
      <div
        id="submit-event-dialog"
        className="settings-modal submit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="submit-event-title"
        ref={dialogRef}
      >
        <header className="settings-modal-header">
          <div className="settings-modal-title">
            <PlusIcon />
            <h2 id="submit-event-title">{translations.addEvent}</h2>
          </div>
          <button
            ref={closeButtonRef}
            className="button button-icon settings-close"
            type="button"
            onClick={onClose}
            aria-label={translations.closeSubmitEvent}
          >
            <XIcon />
          </button>
        </header>

        {!submissionsEnabled ? (
          <div className="settings-scroll-region">
            <p className="error-note" role="status">{translations.submissionsClosed}</p>
          </div>
        ) : state.kind === 'success' ? (
          <div className="settings-scroll-region">
            <p className="success-note" role="status">{state.message}</p>
            <button className="button button-secondary" type="button" onClick={() => setState({ kind: 'idle', message: '' })}>
              {translations.addEvent}
            </button>
          </div>
        ) : (
          <form ref={formRef} className="submit-form" onSubmit={(event) => void submit(event)} noValidate>
            <div className="settings-scroll-region">
              <p className="field-help">{translations.submissionIntro}</p>
              <div className="form-grid">
                <label className="field span-2">
                  <span>{translations.agtUsername} *</span>
                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    required
                    maxLength={LIMITS.agtUsername}
                    autoComplete="username"
                    aria-invalid={usernameError ? true : undefined}
                  />
                  <small className="field-help">{translations.agtUsernameHelp}</small>
                  {usernameError && <small className="field-error">{usernameError}</small>}
                </label>
              </div>
              <EventFormFields
                value={form}
                onChange={setForm}
                errors={errors}
                translations={translations}
                timeZone={timeZone}
                timeZoneOffset={timeZoneOffset}
              />
              <div className="form-grid">
                <label className="field span-2">
                  <span>{translations.coverImage} ({translations.optional})</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={(event) => setCover(event.target.files?.[0] ?? null)}
                    aria-invalid={coverError ? true : undefined}
                  />
                  <small className="field-help">
                    {formatTranslation(translations.coverImageHelp, { size: megabytes(maxImageBytes) })}
                  </small>
                  {coverError && <small className="field-error">{coverError}</small>}
                </label>
                <div className="span-2 captcha-row">
                  <altcha-widget
                    challenge="/api/altcha/challenge"
                    name="altcha"
                    language={altchaLanguage(locale)}
                    auto="onfocus"
                  />
                </div>
              </div>
            </div>
            <footer className="settings-modal-footer">
              <div
                className={`settings-import-status${state.kind === 'error' ? ' error-note' : ''}`}
                role={state.kind === 'error' ? 'alert' : 'status'}
                aria-live="polite"
              >
                {state.message}
              </div>
              <button className="button button-secondary" type="button" onClick={onClose}>
                {translations.closeSubmitEvent}
              </button>
              <button className="button button-primary" type="submit" disabled={state.kind === 'submitting'}>
                {state.kind === 'submitting' ? translations.submitting : translations.submit}
              </button>
            </footer>
          </form>
        )}
      </div>
    </div>
  );
}
