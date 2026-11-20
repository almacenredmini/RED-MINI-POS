import { db } from '../db';
import { enqueue } from '../outbox';
import { cutEmailSubject, renderCutEmail } from '@/services/cutEmail';
import { nowISO, uuidv7 } from '@/services/id';
import type { CashMovement, CashSession, PaymentMethod, ShiftReport, UUID } from '@/types/domain';
import { salesReport, type ReportFilter, type SalesReport } from './reports';

/**
 * Corte, como en Eleventa: lo vendido (en un día, o en un turno de un cajero), cómo se cobró, cuánto
 * efectivo tiene que haber, los retiros, las ventas por categoría y la ganancia.
 * Un turno es una caja: la abre la primera venta del cajero y la cierra él al tocar "Salir",
 * así que un turno que pasa la medianoche queda entero. Sólo lee: las cajas se cierran con "Salir".
 */
export interface DailyCut {
  /** Todo lo vendido, con productos comunes y descontando devoluciones. */
  salesTotal: number;
  tickets: number;
  /** Cobrado por medio de pago (ya descontadas las devoluciones). */
  byMethod: Partial<Record<PaymentMethod, number>>;
  /** Cobrado en el momento: todo menos las cuentas de empleados. */
  paidNow: number;
  cashSales: number;
  deposits: number;
  withdrawals: number;
  /** Efectivo que tiene que haber: ventas en efectivo + entradas − retiros. */
  cashInDrawer: number;
  movements: CashMovement[];
  byCategory: { label: string; total: number }[];
  /** Venta − costo, sólo de productos cargados (los comunes no tienen costo). */
  profit: number;
  returns: SalesReport['returns'];
  voided: SalesReport['voided'];
  /** Sólo en el corte por turno: lo que contó el cajero al cerrar (null = todavía abierta). */
  counted?: number | null;
}

/** `day` en formato `AAAA-MM-DD`, hora local. */
export function dayRange(day: string): { from: string; to: string } {
  const start = new Date(`${day}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

async function buildCut(storeId: UUID, from: string, to: string, filter: ReportFilter, movements: CashMovement[], opening = 0): Promise<DailyCut> {
  const { userId = null, sessionId = null } = filter;
  const report = await salesReport(storeId, from, to, filter);
  const deposits = movements.filter((m) => m.type === 'deposit').reduce((s, m) => s + m.amount_cents, 0);
  const withdrawals = movements.filter((m) => m.type === 'withdrawal').reduce((s, m) => s + m.amount_cents, 0);

  // Tickets de verdad, incluidos los que sólo tienen productos comunes (el reporte no los cuenta).
  const tickets = await db.sales
    .where('[store_id+occurred_at]')
    .between([storeId, from], [storeId, to], true, false)
    .filter((s) => s.status === 'completed' && (userId === null || s.user_id === userId) && (sessionId === null || s.cash_session_id === sessionId))
    .count();
  const cashSales = report.byMethod.cash ?? 0;
  const byCategory = report.byCategory.map((r) => ({ label: r.label, total: r.total }));
  if (report.common.total !== 0) byCategory.push({ label: 'Productos comunes', total: report.common.total });

  return {
    salesTotal: report.total + report.common.total,
    tickets,
    byMethod: report.byMethod,
    paidNow: Object.entries(report.byMethod).reduce((s, [m, v]) => (m === 'employee_account' ? s : s + (v ?? 0)), 0),
    cashSales,
    deposits,
    withdrawals,
    cashInDrawer: opening + cashSales + deposits - withdrawals,
    movements: [...movements].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)),
    byCategory,
    profit: report.total - report.cost,
    returns: report.returns,
    voided: report.voided,
  };
}

/** Corte de un día calendario, de todos los cajeros o de uno. */
export async function dailyCut(storeId: UUID, day: string, userId: UUID | null): Promise<DailyCut> {
  const { from, to } = dayRange(day);
  const sessions = await db.cash_sessions.where('[store_id+opened_at]').between([storeId, ''], [storeId, to], true, false).primaryKeys();
  const movements = (await db.cash_movements.where('cash_session_id').anyOf(sessions).toArray()).filter(
    (m) => m.occurred_at >= from && m.occurred_at < to && (userId === null || m.user_id === userId),
  );
  return buildCut(storeId, from, to, { userId }, movements);
}

/** Corte de un turno (una caja), desde que se abrió hasta que se cerró, aunque pase la medianoche. */
export async function shiftCut(sessionId: UUID): Promise<DailyCut | null> {
  const session = await db.cash_sessions.get(sessionId);
  if (!session) return null;
  // Hasta el cierre; si sigue abierta, hasta ahora (con margen por relojes desparejos entre dispositivos).
  const to = session.closed_at ? new Date(new Date(session.closed_at).getTime() + 1000).toISOString() : '9999-12-31T00:00:00.000Z';
  // Desde un rato antes de la apertura: la primera venta es la que abre la caja y queda con una hora unos
  // milisegundos anterior a `opened_at`. Igual sólo cuenta lo de esta caja (filtro por `sessionId`).
  const from = new Date(new Date(session.opened_at).getTime() - 3_600_000).toISOString();
  const movements = await db.cash_movements.where('cash_session_id').equals(sessionId).toArray();
  const cut = await buildCut(session.store_id, from, to, { sessionId }, movements, session.opening_cents);
  return { ...cut, counted: session.counted_cents };
}

/** Turnos de la sucursal para elegir en Corte: los de los últimos `days` días, del más nuevo al más viejo. */
export async function recentShifts(storeId: UUID, days = 31): Promise<CashSession[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = await db.cash_sessions.where('[store_id+opened_at]').between([storeId, since], [storeId, '￿'], true, true).toArray();
  return rows.sort((a, b) => b.opened_at.localeCompare(a.opened_at));
}

/**
 * Deja en la cola de sincronización el mail del corte de un turno cerrado. Cuando llega a Supabase sale
 * el mail (si está configurado, ver migración 0024). Sin Internet espera en la cola como cualquier cambio.
 */
export async function queueShiftReport(sessionId: UUID): Promise<ShiftReport | null> {
  const session = await db.cash_sessions.get(sessionId);
  if (!session?.closed_at) return null;
  const cut = await shiftCut(sessionId);
  if (!cut) return null;
  const [store, owner] = await Promise.all([db.stores.get(session.store_id), session.opened_by ? db.users.get(session.opened_by) : undefined]);
  const info = { storeName: store?.name ?? 'sin nombre', cashier: owner?.name ?? 'Sin usuario', openedAt: session.opened_at, closedAt: session.closed_at, cut };
  const report: ShiftReport = {
    id: uuidv7(),
    store_id: session.store_id,
    cash_session_id: session.id,
    subject: cutEmailSubject(info),
    html: renderCutEmail(info),
    created_at: nowISO(),
  };
  await db.transaction('rw', db.sync_queue, () => enqueue('shift_reports', report.id, 'upsert', report));
  return report;
}
