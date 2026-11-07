import { useId } from 'react';
import type { ApiEvent } from '../lib/api';
import { localInputToUtcIso, utcIsoToLocalInput } from '../lib/datetime';
import { LIMITS } from '../lib/validation';
import type { FieldError } from '../lib/validation';
import { formatTranslation } from '../translations';
import type { Translations } from '../translations';

export interface EventFormState {
  name: string;
  startLocal: string;
  endLocal: string;
  civilization: string;
  type: string;
  description: string;
  links: string;
  galaxy: string;
  region: string;
  system: string;
  planet: string;
  portalCode: string;
}

export const EMPTY_EVENT_FORM: EventFormState = {
  name: '', startLocal: '', endLocal: '', civilization: '', type: '', description: '', links: '',
  galaxy: 'Euclid', region: '', system: '', planet: '', portalCode: '',
};

export function eventFormFromApi(event: ApiEvent, offsetMinutes: number): EventFormState {
  return {
    name: event.name,
    startLocal: utcIsoToLocalInput(event.start, offsetMinutes),
    endLocal: utcIsoToLocalInput(event.end, offsetMinutes),
    civilization: event.civilization ?? '',
    type: event.type,
    description: event.description ?? '',
    links: event.links.join('\n'),
    galaxy: event.galaxy,
    region: event.region,
    system: event.system,
    planet: event.planet ?? '',
    portalCode: event.portalCode,
  };
}

/** Builds the API payload; times entered in the viewer's offset become UTC. */
export function eventPayload(form: EventFormState, offsetMinutes: number): Record<string, unknown> {
  return {
    name: form.name,
    start: localInputToUtcIso(form.startLocal, offsetMinutes) ?? form.startLocal,
    end: form.endLocal ? localInputToUtcIso(form.endLocal, offsetMinutes) ?? form.endLocal : null,
    civilization: form.civilization,
    type: form.type,
    description: form.description,
    links: form.links.split('\n').map((link) => link.trim()).filter(Boolean),
    galaxy: form.galaxy,
    region: form.region,
    system: form.system,
    planet: form.planet,
    portalCode: form.portalCode,
  };
}

interface EventFormFieldsProps {
  value: EventFormState;
  onChange: (value: EventFormState) => void;
  errors: FieldError[];
  translations: Translations;
  timeZone: string;
  timeZoneOffset: number;
}

export function EventFormFields({ value, onChange, errors, translations, timeZone, timeZoneOffset }: EventFormFieldsProps) {
  const id = useId();
  const errorFor = (field: string) => errors.filter((error) => error.field === field).map((error) => error.message).join(' ');
  const set = (key: keyof EventFormState) => (event: { target: { value: string } }) => onChange({ ...value, [key]: event.target.value });
  const utc = (local: string) => {
    const iso = localInputToUtcIso(local, timeZoneOffset);
    return iso ? formatTranslation(translations.utcPreview, { value: iso.replace('T', ' ').replace('Z', ' UTC') }) : '';
  };

  const text = (
    key: keyof EventFormState,
    field: string,
    label: string,
    options: { required?: boolean; maxLength?: number; placeholder?: string; help?: string; className?: string } = {},
  ) => {
    const error = errorFor(field);
    return (
      <label className={`field ${options.className ?? ''}`}>
        <span>{label}{options.required ? ' *' : ` (${translations.optional})`}</span>
        <input
          value={value[key]}
          onChange={set(key)}
          required={options.required}
          maxLength={options.maxLength}
          placeholder={options.placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-${field}-error` : undefined}
        />
        {options.help && <small className="field-help">{options.help}</small>}
        {error && <small id={`${id}-${field}-error`} className="field-error">{error}</small>}
      </label>
    );
  };

  const dateTime = (key: 'startLocal' | 'endLocal', field: 'start' | 'end', label: string, required: boolean) => {
    const error = errorFor(field);
    return (
      <label className="field">
        <span>{label}{required ? ' *' : ` (${translations.optional})`}</span>
        <input
          type="datetime-local"
          value={value[key]}
          onChange={set(key)}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-${field}-utc${error ? ` ${id}-${field}-error` : ''}`}
        />
        <small id={`${id}-${field}-utc`} className="field-help monospace">{utc(value[key])}</small>
        {error && <small id={`${id}-${field}-error`} className="field-error">{error}</small>}
      </label>
    );
  };

  const descriptionError = errorFor('description');
  const linksError = errorFor('links');
  return (
    <div className="form-grid">
      {text('name', 'name', translations.eventName, { required: true, maxLength: LIMITS.name, className: 'span-2' })}
      {text('type', 'type', translations.eventType, { required: true, maxLength: LIMITS.type })}
      {text('civilization', 'civilization', translations.host, { maxLength: LIMITS.civilization })}
      <p className="field-help span-2">{formatTranslation(translations.dateTimeZoneHelp, { timeZone })}</p>
      {dateTime('startLocal', 'start', translations.startDateTime, true)}
      {dateTime('endLocal', 'end', translations.endDateTime, false)}
      {text('galaxy', 'galaxy', translations.galaxy, { required: true, maxLength: LIMITS.location })}
      {text('region', 'region', translations.region, { required: true, maxLength: LIMITS.location })}
      {text('system', 'system', translations.system, { required: true, maxLength: LIMITS.location })}
      {text('planet', 'planet', translations.planet, { maxLength: LIMITS.location })}
      {text('portalCode', 'portalCode', translations.portalCode, {
        required: true, maxLength: 12, placeholder: '0123ABCD4567', className: 'monospace-input',
      })}
      <label className="field span-2">
        <span>{translations.relatedLinks} ({translations.optional})</span>
        <textarea
          rows={3}
          value={value.links}
          onChange={set('links')}
          placeholder="https://"
          aria-invalid={linksError ? true : undefined}
        />
        <small className="field-help">{translations.relatedLinksHelp}</small>
        {linksError && <small className="field-error">{linksError}</small>}
      </label>
      <label className="field span-2">
        <span>{translations.descriptionMarkdown} ({translations.optional})</span>
        <textarea
          rows={8}
          value={value.description}
          onChange={set('description')}
          maxLength={LIMITS.description}
          aria-invalid={descriptionError ? true : undefined}
        />
        <small className="field-help">{translations.descriptionHelp}</small>
        {descriptionError && <small className="field-error">{descriptionError}</small>}
      </label>
    </div>
  );
}
