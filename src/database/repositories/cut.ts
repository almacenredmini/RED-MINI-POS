import { db } from '../db';
import type { CashMovement, PaymentMethod, UUID } from '@/types/domain';
import { salesReport, type SalesReport } from './reports';

/**
 * Corte del día, como en Eleventa: lo vendido en una sucursal en un día (de todos los cajeros o de uno),
 * cómo se cobró, cuánto efectivo tiene que haber, los retiros, las ventas por categoría y la ganancia.
 * Sólo lee: las cajas se siguen cerrando con "Salir".
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
}

/** `day` en formato `AAAA-MM-DD`, hora local. */
export function dayRange(day: string): { from: string; to: string } {
  const start = new Date(`${day}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

export async function dailyCut(storeId: UUID, day: string, userId: UUID | null): Promise<DailyCut> {
  const { from, to } = dayRange(day);
  const report = await salesReport(storeId, from, to, userId);

  const sessions = await db.cash_sessions.where('[store_id+opened_at]').between([storeId, ''], [storeId, to], true, false).primaryKeys();
  const movements = (await db.cash_movements.where('cash_session_id').anyOf(sessions).toArray())
    .filter((m) => m.occurred_at >= from && m.occurred_at < to && (userId === null || m.user_id === userId))
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const deposits = movements.filter((m) => m.type === 'deposit').reduce((s, m) => s + m.amount_cents, 0);
  const withdrawals = movements.filter((m) => m.type === 'withdrawal').reduce((s, m) => s + m.amount_cents, 0);

  // Tickets de verdad, incluidos los que sólo tienen productos comunes (el reporte no los cuenta).
  const tickets = await db.sales
    .where('[store_id+occurred_at]')
    .between([storeId, from], [storeId, to], true, false)
    .filter((s) => s.status === 'completed' && (userId === null || s.user_id === userId))
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
    cashInDrawer: cashSales + deposits - withdrawals,
    movements,
    byCategory,
    profit: report.total - report.cost,
    returns: report.returns,
    voided: report.voided,
  };
}
