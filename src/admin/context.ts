import { createContext, useContext } from 'react';
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
  URL.revokeObjectURL(url);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
