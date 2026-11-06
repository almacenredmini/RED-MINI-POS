import { db } from '@/database/db';
import { getDeviceId, getMeta, setMeta } from '@/database/meta';
import { nowISO } from '@/services/id';
import { applyRemoteChanges } from './applyRemote';
import { CURSOR_KEY, getSyncConfig, LAST_SYNC_KEY, updateSession } from './config';
import { createSupabaseTransport } from './supabase';
import { SyncAuthError, SyncNetworkError, type SyncTransport } from './transport';

const PUSH_BATCH = 200;
const PULL_PAGE = 500;

export type SyncState = 'off' | 'idle' | 'syncing' | 'offline' | 'auth_error' | 'error';

export interface SyncStatus {
  state: SyncState;
  message: string | null;
}

let status: SyncStatus = { state: 'off', message: null };
const listeners = new Set<() => void>();

function setStatus(next: SyncStatus) {
  status = next;
  listeners.forEach((l) => l());
}

export const getSyncStatus = () => status;
export const subscribeSyncStatus = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Sube la cola en orden. Un cambio rechazado queda guardado como error y no frena al resto. */
async function pushAll(transport: SyncTransport, deviceId: string): Promise<void> {
  for (;;) {
    const batch = await db.transaction('rw', db.sync_queue, async () => {
      const rows = await db.sync_queue.where('status').equals('pending').sortBy('seq');
      const page = rows.slice(0, PUSH_BATCH);
      // Marcados en vuelo: si el registro cambia mientras tanto, se encola aparte y no se pierde.
      await db.sync_queue.bulkPut(page.map((e) => ({ ...e, status: 'in_flight' as const })));
      return page;
    });
    if (batch.length === 0) return;

    const results = await transport.push(
      deviceId,
      batch.map(({ id, table, record_id, op, payload, created_at }) => ({ id, table, record_id, op, payload, created_at })),
    );
    const byId = new Map(results.map((r) => [r.id, r]));

    await db.transaction('rw', db.sync_queue, async () => {
      for (const entry of batch) {
        const r = byId.get(entry.id);
        if (!r) await db.sync_queue.update(entry.seq!, { status: 'pending' });
        else if (r.result === 'rejected') await db.sync_queue.update(entry.seq!, { status: 'error', attempts: entry.attempts + 1, last_error: r.detail ?? 'Rechazado por el servidor' });
        else await db.sync_queue.delete(entry.seq!);
      }
    });
  }
}

async function pullAll(transport: SyncTransport, storeId: string | null): Promise<void> {
  let cursor = (await getMeta<number>(CURSOR_KEY)) ?? 0;
  for (;;) {
    const page = await transport.pull(cursor, storeId, PULL_PAGE);
    await applyRemoteChanges(page.changes);
    // Se guarda después de aplicar: si se corta acá, la misma página vuelve a llegar y no duplica nada.
    cursor = page.next_cursor;
    await setMeta(CURSOR_KEY, cursor);
    if (!page.has_more) return;
  }
}

/** Lo que quedó en vuelo por un corte vuelve a la cola. El servidor reconoce el id y no lo aplica dos veces. */
async function requeueInFlight(): Promise<void> {
  await db.sync_queue.where('status').equals('in_flight').modify({ status: 'pending' });
}

export async function requeueErrors(): Promise<void> {
  await db.sync_queue.where('status').equals('error').modify({ status: 'pending', last_error: null });
}

/** Primero sube y después baja: así el servidor resuelve los conflictos antes de aplicar lo que llega. */
export async function syncWith(transport: SyncTransport, storeId: string | null): Promise<void> {
  const deviceId = await getDeviceId();
  await requeueInFlight();
  await pushAll(transport, deviceId);
  await pullAll(transport, storeId);
  await setMeta(LAST_SYNC_KEY, nowISO());
}

let running = false;

export async function syncNow(): Promise<void> {
  const config = await getSyncConfig();
  if (!config) return setStatus({ state: 'off', message: null });
  if (running) return;
  running = true;
  setStatus({ state: 'syncing', message: null });

  const run = async () => {
    const transport = createSupabaseTransport(config, config.session, updateSession);
    await syncWith(transport, config.scope_store_id);
  };

  try {
    // Con la app abierta en dos pestañas, sólo una sincroniza.
    if (navigator.locks) await navigator.locks.request('red-mini-sync', { ifAvailable: true }, (lock) => (lock ? run() : undefined));
    else await run();
    setStatus({ state: 'idle', message: null });
  } catch (e) {
    if (e instanceof SyncAuthError) setStatus({ state: 'auth_error', message: e.message });
    else if (e instanceof SyncNetworkError) setStatus({ state: 'offline', message: e.message });
    else {
      console.error(e);
      setStatus({ state: 'error', message: 'No se pudo sincronizar. Se vuelve a intentar solo.' });
    }
  } finally {
    running = false;
  }
}
