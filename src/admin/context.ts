import { createContext, useContext } from 'react';
import { errorText, fieldErrorText } from '../lib/errors';
import type { FieldError } from '../lib/errors';
import type { Translations } from '../translations';
import type { AdminTranslations } from './i18n';

export interface AdminContextValue {
  /** Admin dashboard strings. */
  t: AdminTranslations;
  /** Public UI strings (event field labels and validation messages). */
  pt: Translations;
  locale: string;
  timeZone: string;
  timeZoneOffset: number;
}

export const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const value = useContext(AdminContext);
  if (!value) throw new Error('AdminContext is missing');
  return value;
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking right after click() can cancel a large download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** An error in the dashboard's language (I18N-6): admin-only codes from `t`, every other code from `pt`. */
export function errorMessage(error: unknown, value: Pick<AdminContextValue, 't' | 'pt'>): string {
  return errorText(error, { ...value.pt, ...value.t });
}

/** A field error in the dashboard's language, with the translated field label. */
export function fieldMessage(error: FieldError, label: string, value: Pick<AdminContextValue, 't' | 'pt'>): string {
  return fieldErrorText(error, label, { ...value.pt, ...value.t });
}
