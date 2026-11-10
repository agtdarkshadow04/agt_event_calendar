import { useCallback, useEffect, useState } from 'react';
import { imageUrl } from '../lib/api';
import { apiRequest } from '../lib/client';
import type { EventStatus } from '../lib/validation';
import { formatTranslation } from '../translations';
import { errorMessage, useAdmin } from './context';

interface AdminImage {
  id: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  referencedBy: { id: string; name: string; status: EventStatus }[];
}

export function ImagesPanel() {
  const admin = useAdmin();
  const { t, pt } = admin;
  const [images, setImages] = useState<AdminImage[]>([]);
  const [message, setMessage] = useState('');
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    try {
      setImages(await apiRequest<AdminImage[]>('/api/admin/images'));
    } catch (error) {
      setMessage(errorMessage(error, admin));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<unknown>, success = '') => {
    try {
      await action();
      setMessage(success);
      setVersion((value) => value + 1);
      await load();
    } catch (error) {
      setMessage(errorMessage(error, admin));
    }
  };

  const upload = (file: File, id?: string) => {
    const body = new FormData();
    body.set('file', file, file.name);
    void run(() => apiRequest(id ? `/api/admin/images/${id}` : '/api/admin/images', { method: id ? 'PUT' : 'POST', body }), t.saved);
  };

  const cleanup = () => run(async () => {
    const { removed } = await apiRequest<{ removed: number }>('/api/admin/images/cleanup', { method: 'POST' });
    setMessage(formatTranslation(t.removedImages, { count: removed }));
  });

  return (
    <section className="admin-panel" aria-labelledby="images-title">
      <h2 id="images-title">{t.tabImages}</h2>
      <p>{formatTranslation(pt.coverImageHelp, { size: 10 })}</p>
      <div className="admin-toolbar">
        <label className="field">
          <span>{t.uploadImage}</span>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(change) => { const file = change.target.files?.[0]; if (file) upload(file); change.target.value = ''; }} />
        </label>
        <button className="button button-secondary" type="button"
          onClick={() => { if (window.confirm(t.confirmDelete)) void cleanup(); }}>
          {t.removeUnused}
        </button>
      </div>
      {message && <p className="settings-import-status" role="status">{message}</p>}
      {images.length === 0 ? <p className="empty-note">{t.noItems}</p> : (
        <div className="admin-images">
          {images.map((image) => (
            <figure key={image.id} className="admin-image">
              <img src={`${imageUrl(image.id)}?v=${version}`} alt="" loading="lazy" />
              <figcaption>
                <code>{image.id.slice(0, 8)}</code> · {image.mimeType} · {Math.round(image.sizeBytes / 1024)} KB
                <br />
                {image.referencedBy.length === 0
                  ? t.unused
                  : `${t.imageReferencedBy}: ${image.referencedBy.map((event) => event.name).join(', ')}`}
              </figcaption>
              <div className="admin-row-actions">
                <label className="button button-secondary">
                  {t.replace}
                  <input type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={(change) => { const file = change.target.files?.[0]; if (file) upload(file, image.id); }} />
                </label>
                <button className="button button-secondary" type="button"
                  onClick={() => { if (window.confirm(t.confirmDelete)) void run(() => apiRequest(`/api/admin/images/${image.id}`, { method: 'DELETE' })); }}>
                  {t.delete}
                </button>
              </div>
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}
