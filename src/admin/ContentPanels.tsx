import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { AdminApiChangeLogEntry, AdminApiHoliday } from '../lib/api';
import { ApiError, apiRequest } from '../lib/client';
import { splitChanges } from '../lib/validation';
import type { FieldError } from '../lib/validation';
import { errorMessage, fieldMessage, useAdmin } from './context';

interface Column<T> { label: string; render: (item: T) => ReactNode }
interface FieldSpec { key: string; label: string; type?: 'text' | 'date' | 'textarea'; help?: string }

/** Generic list + editor for simple content with a published flag. */
function ContentPanel<T extends { id: string; published: boolean }>({
  title, endpoint, columns, fields, empty, newLabel,
}: {
  title: string;
  endpoint: string;
  columns: Column<T>[];
  fields: FieldSpec[];
  empty: Record<string, string>;
  newLabel: string;
}) {
  const admin = useAdmin();
  const { t } = admin;
  const [items, setItems] = useState<T[]>([]);
  const [editing, setEditing] = useState<{ id: string | null; values: Record<string, string>; published: boolean } | null>(null);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      setItems(await apiRequest<T[]>(endpoint));
    } catch (error) {
      setMessage(errorMessage(error, admin));
    }
  }, [endpoint]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    try {
      await apiRequest(editing.id ? `${endpoint}/${editing.id}` : endpoint, {
        method: editing.id ? 'PUT' : 'POST',
        json: { ...editing.values, published: editing.published },
      });
      setEditing(null);
      setErrors([]);
      setMessage(t.saved);
      await load();
    } catch (error) {
      if (error instanceof ApiError && error.fields) setErrors(error.fields);
      setMessage(errorMessage(error, admin));
    }
  };

  const update = async (item: T, published: boolean) => {
    const values = Object.fromEntries(fields.map((field) => [field.key, String((item as Record<string, unknown>)[field.key] ?? '')]));
    try {
      await apiRequest(`${endpoint}/${item.id}`, { method: 'PUT', json: { ...values, published } });
      await load();
    } catch (error) {
      setMessage(errorMessage(error, admin));
    }
  };

  const remove = async (item: T) => {
    if (!window.confirm(t.confirmDelete)) return;
    try {
      await apiRequest(`${endpoint}/${item.id}`, { method: 'DELETE' });
      await load();
    } catch (error) {
      setMessage(errorMessage(error, admin));
    }
  };

  const startEdit = (item: T | null) => {
    setErrors([]);
    setMessage('');
    setEditing(item
      ? { id: item.id, values: Object.fromEntries(fields.map((field) => [field.key, String((item as Record<string, unknown>)[field.key] ?? '')])), published: item.published }
      : { id: null, values: { ...empty }, published: true });
  };

  return (
    <section className="admin-panel" aria-label={title}>
      <h2>{title}</h2>
      {editing ? (
        <form className="admin-form" onSubmit={(event) => void save(event)} noValidate>
          <div className="form-grid">
            {fields.map((field) => {
              const error = errors.filter((item) => item.field === field.key).map((item) => fieldMessage(item, field.label, admin)).join(' ');
              const common = {
                value: editing.values[field.key] ?? '',
                onChange: (change: { target: { value: string } }) =>
                  setEditing({ ...editing, values: { ...editing.values, [field.key]: change.target.value } }),
                'aria-invalid': error ? true : undefined,
              };
              return (
                <label key={field.key} className={`field${field.type === 'textarea' ? ' span-2' : ''}`}>
                  <span>{field.label}</span>
                  {field.type === 'textarea' ? <textarea rows={5} {...common} /> : <input type={field.type ?? 'text'} {...common} />}
                  {field.help && <small className="field-help">{field.help}</small>}
                  {error && <small className="field-error">{error}</small>}
                </label>
              );
            })}
            <label className="admin-checkbox">
              <input type="checkbox" checked={editing.published} onChange={(change) => setEditing({ ...editing, published: change.target.checked })} />
              {t.published}
            </label>
          </div>
          {message && <p className="error-note" role="alert">{message}</p>}
          <div className="admin-row-actions">
            <button className="button button-primary" type="submit">{t.save}</button>
            <button className="button button-secondary" type="button" onClick={() => setEditing(null)}>{t.cancel}</button>
          </div>
        </form>
      ) : (
        <>
          <div className="admin-toolbar">
            <button className="button button-primary" type="button" onClick={() => startEdit(null)}>{newLabel}</button>
          </div>
          {message && <p className="settings-import-status" role="status">{message}</p>}
          {items.length === 0 ? <p className="empty-note">{t.noItems}</p> : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    {columns.map((column) => <th key={column.label}>{column.label}</th>)}
                    <th>{t.status}</th>
                    <th>{t.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      {columns.map((column) => <td key={column.label}>{column.render(item)}</td>)}
                      <td>
                        <span className={`status-pill ${item.published ? 'published' : 'unpublished'}`}>
                          {item.published ? t.statusPublished : t.statusUnpublished}
                        </span>
                      </td>
                      <td>
                        <div className="admin-row-actions">
                          <button className="button button-secondary" type="button" onClick={() => void update(item, !item.published)}>
                            {item.published ? t.unpublish : t.publish}
                          </button>
                          <button className="button button-secondary" type="button" onClick={() => startEdit(item)}>{t.edit}</button>
                          <button className="button button-secondary" type="button" onClick={() => void remove(item)}>{t.delete}</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function HolidaysPanel() {
  const { t, pt } = useAdmin();
  return (
    <ContentPanel<AdminApiHoliday>
      title={t.tabHolidays}
      endpoint="/api/admin/holidays"
      newLabel={t.newHoliday}
      empty={{ name: '', civilization: '', date: '', type: '' }}
      fields={[
        { key: 'name', label: t.name },
        { key: 'civilization', label: pt.host },
        { key: 'date', label: t.date, type: 'date', help: t.holidayDateHelp },
        { key: 'type', label: pt.eventType },
      ]}
      columns={[
        { label: t.date, render: (holiday) => holiday.date },
        { label: t.name, render: (holiday) => holiday.name },
        { label: pt.host, render: (holiday) => holiday.civilization },
        { label: pt.eventType, render: (holiday) => holiday.type },
      ]}
    />
  );
}

export function ChangeLogPanel() {
  const { t } = useAdmin();
  return (
    <ContentPanel<AdminApiChangeLogEntry>
      title={t.tabChangeLog}
      endpoint="/api/admin/changelog"
      newLabel={t.newEntry}
      empty={{ date: new Date().toISOString().slice(0, 10), changes: '' }}
      fields={[
        { key: 'date', label: t.date, type: 'date' },
        { key: 'changes', label: t.changes, type: 'textarea', help: t.changesHelp },
      ]}
      columns={[
        { label: t.date, render: (entry) => entry.date },
        { label: t.changes, render: (entry) => <ul className="admin-list">{splitChanges(entry.changes).map((change, index) => <li key={index}>{change}</li>)}</ul> },
      ]}
    />
  );
}
