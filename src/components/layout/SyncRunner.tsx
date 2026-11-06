import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/database/db';
import { requeueErrors, syncNow } from '@/services/sync/engine';

const INTERVAL_MS = 30_000;
const AFTER_CHANGE_MS = 2_000;

/** Sincroniza sola: cada 30 segundos, al volver Internet, al volver a la app y poco después de cada cambio. */
export function SyncRunner() {
  const pending = useLiveQuery(() => db.sync_queue.where('status').equals('pending').count(), [], 0);

  useEffect(() => {
    void requeueErrors().then(syncNow);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncNow();
    };
    const tick = () => void syncNow();
    const timer = setInterval(tick, INTERVAL_MS);
    window.addEventListener('online', tick);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    if (pending === 0) return;
    const timer = setTimeout(() => void syncNow(), AFTER_CHANGE_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  return null;
}
