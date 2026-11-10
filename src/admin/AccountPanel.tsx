import { useState } from 'react';
import type { FormEvent } from 'react';
import { apiRequest } from '../lib/client';
import { errorMessage, useAdmin } from './context';

export function AccountPanel() {
  const admin = useAdmin();
  const { t } = admin;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<{ error: boolean; text: string }>({ error: false, text: '' });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (next !== confirm) {
      setMessage({ error: true, text: t.passwordsDiffer });
      return;
    }
    try {
      await apiRequest('/api/admin/password', { method: 'POST', json: { currentPassword: current, newPassword: next } });
      setCurrent('');
      setNext('');
      setConfirm('');
      setMessage({ error: false, text: t.passwordChanged });
    } catch (error) {
      setMessage({ error: true, text: errorMessage(error, admin) });
    }
  };

  return (
    <section className="admin-panel admin-auth flush" aria-labelledby="account-title">
      <h2 id="account-title">{t.changePassword}</h2>
      <form onSubmit={(event) => void submit(event)}>
        <label className="field">
          <span>{t.currentPassword}</span>
          <input type="password" value={current} onChange={(change) => setCurrent(change.target.value)} autoComplete="current-password" required />
        </label>
        <label className="field">
          <span>{t.newPassword}</span>
          <input type="password" value={next} onChange={(change) => setNext(change.target.value)} autoComplete="new-password" required minLength={12} />
        </label>
        <label className="field">
          <span>{t.confirmPassword}</span>
          <input type="password" value={confirm} onChange={(change) => setConfirm(change.target.value)} autoComplete="new-password" required />
        </label>
        <small className="field-help">{t.passwordHint}</small>
        {message.text && <p className={message.error ? 'error-note' : 'success-note'} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
        <button className="button button-primary" type="submit">{t.changePassword}</button>
      </form>
    </section>
  );
}
