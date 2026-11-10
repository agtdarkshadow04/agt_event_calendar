import { useRef, useState } from 'react';
import {
  createDefaultSettings,
  AUTO_TIME_ZONE,
  FONT_SCALES,
  LOCALES,
  parseSettingsJson,
  TIME_ZONE_OPTIONS,
} from '../lib/settings';
import type {
  AnthemSetting,
  AppSettings,
  FontScale,
  Locale,
} from '../lib/settings';
import { HistoryIcon, ReloadIcon, SettingsIcon, XIcon } from './Icons';
import { getTranslations } from '../translations';
import { useDialog } from './useDialog';

interface SettingsModalProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  onReloadDatabase?: () => void;
  onOpenChangeLog: () => void;
  onClose: () => void;
}

type ImportState =
  | { kind: 'idle'; message: '' }
  | { kind: 'success' | 'error'; message: string };

function exportFileName(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `AGT Event Calendar Settings - ${timestamp}.json`;
}

export function SettingsModal({
  settings,
  onChange,
  onReloadDatabase,
  onOpenChangeLog,
  onClose,
}: SettingsModalProps) {
  const translations = getTranslations(settings.locale);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importState, setImportState] = useState<ImportState>({
    kind: 'idle',
    message: '',
  });

  useDialog(dialogRef, closeButtonRef, onClose);

  const update = <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => {
    onChange({ ...settings, [key]: value });
    setImportState({ kind: 'idle', message: '' });
  };

  const exportSettings = () => {
    let url: string | null = null;
    try {
      const blob = new Blob([JSON.stringify(settings, null, 2)], {
        type: 'application/json',
      });
      url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = exportFileName();
      document.body.appendChild(link);
      link.click();
      link.remove();
      setImportState({
        kind: 'success',
        message: translations.settingsExported,
      });
    } catch (error: unknown) {
      console.error('Unable to export calendar settings', error);
      setImportState({
        kind: 'error',
        message: translations.settingsExportError,
      });
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  };

  const resetSettings = () => {
    onChange(createDefaultSettings());
    setImportState({ kind: 'success', message: translations.settingsReset });
  };

  const importSettings = async (file: File) => {
    try {
      const imported = parseSettingsJson(await file.text(), settings.locale);
      onChange(imported);
      setImportState({
        kind: 'success',
        message: translations.settingsImported,
      });
    } catch (error: unknown) {
      setImportState({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : translations.settingsImportError,
      });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
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
        id="settings-dialog"
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        ref={dialogRef}
      >
        <header className="settings-modal-header">
          <div className="settings-modal-title">
            <SettingsIcon className="settings-modal-icon" />
            <div>
              <p className="eyebrow">{translations.calendarPreferences}</p>
              <h2 id="settings-dialog-title">{translations.settings}</h2>
            </div>
          </div>
          <div className="modal-header-actions">
            <button
              className="button button-secondary button-icon"
              type="button"
              onClick={onOpenChangeLog}
              aria-label={translations.changeLog}
              aria-haspopup="dialog"
              aria-controls="change-log-dialog"
              title={translations.changeLog}
            >
              <HistoryIcon />
            </button>
            {onReloadDatabase && (
              <button
                className="button button-secondary button-icon"
                type="button"
                onClick={onReloadDatabase}
                aria-label={translations.reloadDatabase}
                title={translations.reloadDatabase}
              >
                <ReloadIcon />
              </button>
            )}
            <button
              ref={closeButtonRef}
              className="button button-icon settings-close"
              type="button"
              onClick={onClose}
              aria-label={translations.closeSettings}
            >
              <XIcon />
            </button>
          </div>
        </header>

        <div className="settings-scroll-region">
          <div className="settings-grid">
            <label className="settings-field">
              <span>{translations.fontScale}</span>
              <select
                value={settings.fontScale}
                onChange={(event) =>
                  update('fontScale', event.target.value as FontScale)
                }
              >
                {FONT_SCALES.map((scale) => (
                  <option key={scale} value={scale}>
                    {scale === '1x'
                      ? `1x (${translations.defaultLabel})`
                      : scale}
                  </option>
                ))}
              </select>
              <small>{translations.fontScaleHelp}</small>
            </label>

            <label className="settings-field">
              <span>{translations.locale}</span>
              <select
                className="locale-select"
                value={settings.locale}
                onChange={(event) =>
                  update('locale', event.target.value as Locale)
                }
              >
                {LOCALES.map((locale) => (
                  <option key={locale.value} value={locale.value}>
                    {locale.flag} {locale.label}
                  </option>
                ))}
              </select>
              <small>{translations.localeHelp}</small>
            </label>

            <label className="settings-field">
              <span>{translations.localTimezone}</span>
              <select
                value={settings.timeZone}
                onChange={(event) => update('timeZone', event.target.value)}
              >
                {TIME_ZONE_OPTIONS.map((timeZone) => (
                  <option key={timeZone.value} value={timeZone.value}>
                    {timeZone.value === AUTO_TIME_ZONE
                      ? translations.autoTimeZone
                      : timeZone.label}
                  </option>
                ))}
              </select>
              <small>{translations.timeZoneHelp}</small>
            </label>

            <label className="settings-field">
              <span>{translations.agtAnthem}</span>
              <select
                value={settings.anthem}
                onChange={(event) =>
                  update('anthem', event.target.value as AnthemSetting)
                }
              >
                <option value="mute">{translations.muteDefault}</option>
                <option value="unmute">{translations.unmute}</option>
              </select>
              <small>{translations.anthemHelp}</small>
            </label>
          </div>
        </div>

        <footer className="settings-modal-footer">
          <div
            className={`settings-import-status${
              importState.kind === 'error' ? ' error-note' : ''
            }`}
            role={importState.kind === 'error' ? 'alert' : 'status'}
            aria-live="polite"
          >
            {importState.message}
          </div>
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            // Opened by the Import button below; it has a name for assistive technology but no tab stop of its own.
            tabIndex={-1}
            aria-label={translations.import}
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importSettings(file);
            }}
          />
          <button
            className="button button-secondary"
            type="button"
            onClick={resetSettings}
          >
            {translations.reset}
          </button>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            {translations.import}
          </button>
          <button className="button button-primary" type="button" onClick={exportSettings}>
            {translations.export}
          </button>
        </footer>
      </div>
    </div>
  );
}
