import { db } from '../db';
import { getDeviceId, peekDeviceId } from '../meta';
import { enqueue } from '../outbox';
import { nowISO, uuidv7 } from '@/services/id';
import type { CashMovement, CashSession, Payment } from '@/types/domain';

/**
 * Caja por dispositivo (ADR 21). La abre sola la primera venta, arranca en $0 y la cierra
 * con conteo a ciegas el cajero que la abrió al tocar "Salir". Mientras está abierta, todo
 * lo que se vende en el dispositivo entra en ella, aunque lo venda el dueño.
 */

/** La caja abierta de este dispositivo, si hay. */
export async function getOpenSession(deviceId?: string): Promise<CashSession | undefined> {
  // Sólo lectura: se usa dentro de useLiveQuery, donde no se puede crear el id.
  const device = deviceId ?? (await peekDeviceId());
  if (!device) return undefined;
  return db.cash_sessions
    .where('device_id')
    .equals(device)
    .filter((s) => s.closed_at === null)
    .first();
}

/**
 * Devuelve la caja abierta o abre una nueva a nombre de `userId`.
 * Debe llamarse dentro de una transacción que incluya `cash_sessions` y `sync_queue`.
 */
export async function ensureOpenSession(storeId: string, userId: string | null, deviceId: string): Promise<CashSession> {
  const open = await getOpenSession(deviceId);
  if (open) return open;
  const now = nowISO();
  const session: CashSession = {
    id: uuidv7(),
    store_id: storeId,
    device_id: deviceId,
    opened_by: userId,
    opened_at: now,
    opening_cents: 0,
    closed_by: null,
    closed_at: null,
    expected_cents: null,
    counted_cents: null,
    notes: null,
    created_at: now,
    updated_at: now,
    version: 1,
    updated_by_device: deviceId,
  };
  await db.cash_sessions.add(session);
  await enqueue('cash_sessions', session.id, 'upsert', session);
  return session;
}

export interface CashSummary {
  session: CashSession;
  tickets: number;
  total: number;
  /** Total cobrado por medio de pago (sin vuelto). */
  byMethod: Partial<Record<Payment['method'], number>>;
  withdrawals: number;
  deposits: number;
  /** Efectivo que tiene que haber en el cajón. */
  expected: number;
  movements: CashMovement[];
  /** Ventas por usuario: así se ve lo que vendió el dueño en la caja del cajero. */
  byUser: { userId: string | null; tickets: number; total: number }[];
  voided: number;
}

export async function cashSummary(sessionId: string): Promise<CashSummary | null> {
  const session = await db.cash_sessions.get(sessionId);
  if (!session) return null;
  const sales = await db.sales.where('cash_session_id').equals(sessionId).toArray();
  const completed = sales.filter((s) => s.status === 'completed');
  const payments = await db.payments.where('sale_id').anyOf(completed.map((s) => s.id)).toArray();
  const movements = (await db.cash_movements.where('cash_session_id').equals(sessionId).toArray()).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));

  const byMethod: CashSummary['byMethod'] = {};
  for (const p of payments) byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount_cents;
  const withdrawals = movements.filter((m) => m.type === 'withdrawal').reduce((s, m) => s + m.amount_cents, 0);
  const deposits = movements.filter((m) => m.type === 'deposit').reduce((s, m) => s + m.amount_cents, 0);

  const users = new Map<string | null, { userId: string | null; tickets: number; total: number }>();
  for (const s of completed) {
    const row = users.get(s.user_id) ?? { userId: s.user_id, tickets: 0, total: 0 };
    row.tickets += 1;
    row.total += s.total_cents;
    users.set(s.user_id, row);
  }

  return {
    session,
    tickets: completed.length,
    total: completed.reduce((s, x) => s + x.total_cents, 0),
    byMethod,
    withdrawals,
    deposits,
    expected: session.opening_cents + (byMethod.cash ?? 0) + deposits - withdrawals,
    movements,
    byUser: [...users.values()].sort((a, b) => b.total - a.total),
    voided: sales.length - completed.length,
  };
}

export async function addCashMovement(input: { sessionId: string; type: CashMovement['type']; amount: number; reason: string; userId: string | null }): Promise<CashMovement> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new Error('Ingresá un monto mayor a cero');
  if (!input.reason.trim()) throw new Error('Indicá el motivo');
  const deviceId = await getDeviceId();
  return db.transaction('rw', [db.cash_sessions, db.cash_movements, db.sync_queue], async () => {
    const session = await db.cash_sessions.get(input.sessionId);
    if (!session || session.closed_at) throw new Error('La caja ya está cerrada');
    const movement: CashMovement = {
      id: uuidv7(),
      cash_session_id: session.id,
      type: input.type,
      amount_cents: input.amount,
      reason: input.reason.trim(),
      user_id: input.userId,
      device_id: deviceId,
      occurred_at: nowISO(),
    };
    await db.cash_movements.add(movement);
    await enqueue('cash_movements', movement.id, 'upsert', movement);
    return movement;
  });
}

export interface CloseResult {
  expected: number;
  counted: number;
  /** Positivo sobra, negativo falta. */
  difference: number;
}

/** Cierra la caja con lo contado. El esperado se calcula y se guarda en el mismo momento. */
export async function closeSession(sessionId: string, counted: number, userId: string | null, notes: string | null = null): Promise<CloseResult> {
  if (!Number.isInteger(counted) || counted < 0) throw new Error('Ingresá el efectivo contado');
  const deviceId = await getDeviceId();
  return db.transaction('rw', [db.cash_sessions, db.cash_movements, db.sales, db.payments, db.sync_queue], async () => {
    const summary = await cashSummary(sessionId);
    if (!summary) throw new Error('La caja no existe');
    if (summary.session.closed_at) throw new Error('La caja ya está cerrada');
    const now = nowISO();
    const closed: CashSession = {
      ...summary.session,
      closed_by: userId,
      closed_at: now,
      expected_cents: summary.expected,
      counted_cents: counted,
      notes: notes?.trim() || null,
      updated_at: now,
      version: summary.session.version + 1,
      updated_by_device: deviceId,
    };
    await db.cash_sessions.put(closed);
    await enqueue('cash_sessions', closed.id, 'upsert', closed);
    return { expected: summary.expected, counted, difference: counted - summary.expected };
  });
}

/** Nota del cajero después de cerrar con diferencia (por qué cree que pasó). Vacía = sin nota. */
export async function setCloseNote(sessionId: string, notes: string): Promise<void> {
  const deviceId = await getDeviceId();
  await db.transaction('rw', [db.cash_sessions, db.sync_queue], async () => {
    const session = await db.cash_sessions.get(sessionId);
    if (!session?.closed_at) throw new Error('La caja no está cerrada');
    const updated: CashSession = { ...session, notes: notes.trim() || null, updated_at: nowISO(), version: session.version + 1, updated_by_device: deviceId };
    await db.cash_sessions.put(updated);
    await enqueue('cash_sessions', updated.id, 'upsert', updated);
  });
}

/** Cajas de una sucursal (o de todas) abiertas en el período, de la más nueva a la más vieja. */
export async function listSessions(storeId: string | null, from: string, to: string): Promise<CashSession[]> {
  const rows = storeId
    ? await db.cash_sessions.where('[store_id+opened_at]').between([storeId, from], [storeId, to], true, false).toArray()
    : await db.cash_sessions.where('opened_at').between(from, to, true, false).toArray();
  return rows.sort((a, b) => b.opened_at.localeCompare(a.opened_at));
}

/** Todas las cajas abiertas de una sucursal, en cualquier dispositivo. */
export async function listOpenSessions(storeId: string | null): Promise<CashSession[]> {
  const rows = await db.cash_sessions.filter((s) => s.closed_at === null && (storeId === null || s.store_id === storeId)).toArray();
  return rows.sort((a, b) => b.opened_at.localeCompare(a.opened_at));
}

export const difference = (s: Pick<CashSession, 'expected_cents' | 'counted_cents'>) =>
  s.expected_cents === null || s.counted_cents === null ? null : s.counted_cents - s.expected_cents;

