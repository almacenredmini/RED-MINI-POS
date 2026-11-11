import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/database/db';
import { requeueErrors, syncNow } from '@/services/sync/engine';

/** Lo que cambia en otro dispositivo aparece acá en unos segundos, sin recargar la página. */
const INTERVAL_MS = 10_000;
const AFTER_CHANGE_MS = 2_000;

/**
 * Sincroniza sola: cada 10 segundos mientras la app está a la vista, al volver a ella,
 * al volver Internet y poco después de cada cambio. En segundo plano no consulta, para no gastar datos.
 */
export function SyncRunner() {
  const pending = useLiveQuery(() => db.sync_queue.where('status').equals('pending').count(), [], 0);

  useEffect(() => {
    void requeueErrors().then(syncNow);
    const tick = () => {
      if (document.visibilityState === 'visible') void syncNow();
    };
    const timer = setInterval(tick, INTERVAL_MS);
    // iPhone no siempre avisa con visibilitychange al volver a una app instalada: focus y pageshow lo cubren.
    const events: Array<[EventTarget, string]> = [
      [window, 'online'],
      [window, 'focus'],
      [window, 'pageshow'],
      [document, 'visibilitychange'],
    ];
    events.forEach(([target, name]) => target.addEventListener(name, tick));
    return () => {
      clearInterval(timer);
      events.forEach(([target, name]) => target.removeEventListener(name, tick));
    };
  }, []);

  useEffect(() => {
    if (pending === 0) return;
    const timer = setTimeout(() => void syncNow(), AFTER_CHANGE_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  return null;
}
