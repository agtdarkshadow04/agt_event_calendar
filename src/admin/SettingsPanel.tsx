import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../lib/client';
import { errorMessage, useAdmin } from './context';

interface SettingState {
  key: string;
  value: unknown;
  source: 'config' | 'dashboard' | 'default';
  locked: boolean;
  default: unknown;
  description: string;
}

/**
 * Dashboard settings. Keys defined in config.yaml are shown read-only; the
 * server also rejects changes to them (409), so this is only a convenience.
 */
export function SettingsPanel() {
  const admin = useAdmin();
  const { t } = admin;
  const [states, setStates] = useState<SettingState[]>([]);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [message, setMessage] = useState<{ error: boolean; text: string }>({ error: false, text: '' });

  const load = useCallback(async () => {
    try {
      const result = await apiRequest<SettingState[]>('/api/admin/settings');
      setStates(result);
      setDraft({});
    } catch (error) {
      setMessage({ error: true, text: errorMessage(error, admin) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (values: Record<string, unknown>) => {
    try {
      setStates(await apiRequest<SettingState[]>('/api/admin/settings', { method: 'PUT', json: { values } }));
      setDraft({});
      setMessage({ error: false, text: t.saved });
    } catch (error) {
      setMessage({ error: true, text: errorMessage(error, admin) });
    }
  };

  const sourceLabel = (state: SettingState) =>
    state.source === 'config' ? t.setInConfig : state.source === 'dashboard' ? t.sourceDashboard : t.sourceDefault;

  return (
    <section className="admin-panel" aria-labelledby="settings-title">
      <h2 id="settings-title">{t.tabSettings}</h2>
      <p>{t.settingsIntro}</p>
      <div>
        {states.map((state) => {
          const value = state.key in draft ? draft[state.key] : state.value;
          const set = (next: unknown) => setDraft({ ...draft, [state.key]: next });
          return (
            <div key={state.key} className="setting-row">
              <div>
                <code>{state.key}</code>
                <p className="field-help">{state.description}</p>
                <p className="field-help">{sourceLabel(state)}</p>
              </div>
              <div className="admin-toolbar">
                {typeof state.default === 'boolean' ? (
                  <label className="admin-checkbox">
                    <input type="checkbox" checked={Boolean(value)} disabled={state.locked}
                      onChange={(change) => set(change.target.checked)} aria-label={state.key} />
                    {state.key}
                  </label>
                ) : (
                  <label className="field">
                    <span>{state.key}</span>
                    <input
                      type={typeof state.default === 'number' ? 'number' : 'text'}
                      value={String(value ?? '')}
                      readOnly={state.locked}
                      aria-readonly={state.locked}
                      onChange={(change) => set(typeof state.default === 'number' ? Number(change.target.value) : change.target.value)}
                    />
                  </label>
                )}
                {!state.locked && state.source === 'dashboard' && (
                  <button className="button button-secondary" type="button" onClick={() => void save({ [state.key]: null })}>
                    {t.resetDefault}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="admin-toolbar">
        <button className="button button-primary" type="button" disabled={Object.keys(draft).length === 0} onClick={() => void save(draft)}>
          {t.saveSettings}
        </button>
        {message.text && <p className={message.error ? 'error-note' : 'settings-import-status'} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
      </div>
    </section>
  );
}
