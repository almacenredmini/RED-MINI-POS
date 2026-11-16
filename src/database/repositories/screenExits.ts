import { db } from '../db';
import { getDeviceId } from '../meta';
import { enqueue } from '../outbox';
import { uuidv7 } from '@/services/id';
import type { ScreenExit, UUID } from '@/types/domain';

/**
 * Salidas de la pantalla de venta: quien no tiene `app.unlocked` trabaja en pantalla completa,
 * y cada vez que sale queda registrado. No se puede impedir del todo, pero queda constancia.
 */

export interface ExitInput {
  store_id: UUID;
  user_id: UUID | null;
  user_name: string;
  left_at: string;
  returned_at: string;
}

/** Salidas de menos de 2 segundos no se registran: son parpadeos al cambiar de modo o al imprimir. */
const MIN_SECONDS = 2;

export async function logScreenExit(input: ExitInput): Promise<ScreenExit | null> {
  const seconds = Math.max(0, Math.round((Date.parse(input.returned_at) - Date.parse(input.left_at)) / 1000));
  if (!Number.isFinite(seconds) || seconds < MIN_SECONDS) return null;
  const exit: ScreenExit = { id: uuidv7(), ...input, device_id: await getDeviceId(), seconds };
  await db.transaction('rw', db.screen_exits, db.sync_queue, async () => {
    await db.screen_exits.add(exit);
    await enqueue('screen_exits', exit.id, 'upsert', exit);
  });
  return exit;
}

/** Entre dos fechas ISO (desde incluida, hasta excluida), la más reciente primero. */
export async function listScreenExits(storeId: UUID | null, from: string, to: string): Promise<ScreenExit[]> {
  const rows = await db.screen_exits.where('left_at').between(from, to, true, false).toArray();
  return rows.filter((e) => !storeId || e.store_id === storeId).sort((a, b) => b.left_at.localeCompare(a.left_at));
}

/** "45 s", "3 min", "1 h 5 min". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

// ---------------------------------------------------------------------------
// Salida en curso: se guarda en el dispositivo por si cierran el programa mientras están afuera.
// ---------------------------------------------------------------------------

const PENDING_KEY = 'redmini.screenExit';

export interface PendingExit extends Omit<ExitInput, 'returned_at'> {
  /** Última vez que se vio la app abierta durante la salida: si la cierran, la salida termina ahí. */
  last_seen: string;
}

export function savePendingExit(p: PendingExit | null) {
  try {
    if (p) localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    /* sin almacenamiento: sólo se pierde una salida si cierran el programa estando afuera */
  }
}

export function readPendingExit(): PendingExit | null {
  try {
    const v = localStorage.getItem(PENDING_KEY);
    return v ? (JSON.parse(v) as PendingExit) : null;
  } catch {
    return null;
  }
}

/** Al abrir el programa: si quedó una salida sin terminar, se registra hasta la última vez que se vio. */
export async function flushPendingExit(): Promise<void> {
  const p = readPendingExit();
  if (!p) return;
  savePendingExit(null);
  const { last_seen, ...rest } = p;
  await logScreenExit({ ...rest, returned_at: last_seen });
}
