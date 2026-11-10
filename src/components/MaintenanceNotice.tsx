import { useSyncExternalStore } from 'react';
import { isMaintenanceActive, subscribeMaintenance } from '../lib/maintenance';

/**
 * Non-blocking "Maintenance in progress" notice, shown while the server answers `503 maintenance` (FE-5). It never
 * hides the page or signs anyone out; it clears with the next API response that is not `503 maintenance`.
 */
export function MaintenanceNotice({ text, className }: { text: string; className: string }) {
  const active = useSyncExternalStore(subscribeMaintenance, isMaintenanceActive, () => false);
  if (!active) return null;
  return <p className={className} role="status">{text}</p>;
}
