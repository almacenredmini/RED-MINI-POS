import Dexie from 'dexie';
import { db } from '../db';
import { getMeta, setMeta } from '../meta';
import { nowISO } from '@/services/id';
import type { Product, StoreMinStock } from '@/types/domain';
import { listSales } from './sales';

/** Semanas completas de ventas que se promedian. */
const WINDOW_WEEKS = 4;
/** Semanas de venta que tiene que cubrir el stock antes de dar aviso. */
const COVER_WEEKS = 1;

const DAY_MS = 86_400_000;

/** Lunes 00:00 hora local de la semana de `date`. */
export function weekStart(date: Date): Date {
  const daysSinceMonday = (date.getDay() + 6) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - daysSinceMonday);
}

/**
 * Recalcula el mínimo de cada producto de una sucursal: promedio semanal de lo vendido en las últimas
 * semanas completas. La semana en curso no cuenta porque todavía está incompleta.
 */
export async function recalcMinStock(storeId: string, now: Date = new Date()): Promise<void> {
  const end = weekStart(now);
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - WINDOW_WEEKS * 7);

  const first = await db.sales.where('[store_id+occurred_at]').between([storeId, Dexie.minKey], [storeId, Dexie.maxKey]).first();
  const rows: StoreMinStock[] = [];

  if (first && first.occurred_at < end.toISOString()) {
    // Un local con pocas semanas de historia promedia sólo las que tiene, para no subestimar.
    const elapsed = Math.ceil((end.getTime() - new Date(first.occurred_at).getTime()) / (7 * DAY_MS));
    const weeks = Math.min(Math.max(elapsed, 1), WINDOW_WEEKS);

    const sales = (await listSales(storeId, start.toISOString(), end.toISOString())).filter((s) => s.status === 'completed');
    const items = await db.sale_items.where('sale_id').anyOf(sales.map((s) => s.id)).toArray();

    const sold = new Map<string, number>();
    for (const i of items) {
      if (i.product_id) sold.set(i.product_id, (sold.get(i.product_id) ?? 0) + i.quantity);
    }

    const computedAt = nowISO();
    for (const [productId, units] of sold) {
      const weekly = units / weeks;
      rows.push({
        id: `${storeId}:${productId}`,
        store_id: storeId,
        product_id: productId,
        min_stock: Math.ceil(weekly * COVER_WEEKS),
        weekly_avg: weekly,
        computed_at: computedAt,
      });
    }
  }

  await db.transaction('rw', db.store_min_stock, db.meta, async () => {
    await db.store_min_stock.where('store_id').equals(storeId).delete();
    await db.store_min_stock.bulkPut(rows);
    await setMeta(weekKey(storeId), end.toISOString());
  });
}

const weekKey = (storeId: string) => `min_stock_week:${storeId}`;

/** Se ejecuta al entrar a la sucursal: recalcula una sola vez por semana. */
export async function recalcMinStockIfNewWeek(storeId: string, now: Date = new Date()): Promise<void> {
  const last = await getMeta<string>(weekKey(storeId));
  if (last !== weekStart(now).toISOString()) await recalcMinStock(storeId, now);
}

export async function getAutoMinMap(storeId: string): Promise<Map<string, StoreMinStock>> {
  const rows = await db.store_min_stock.where('store_id').equals(storeId).toArray();
  return new Map(rows.map((r) => [r.product_id, r]));
}

/** Sin ventas suficientes, o con el cálculo apagado, vale el mínimo cargado a mano. */
export function effectiveMinStock(product: Pick<Product, 'id' | 'min_stock' | 'auto_min_stock'>, auto: Map<string, StoreMinStock>): number {
  if (!product.auto_min_stock) return product.min_stock;
  return auto.get(product.id)?.min_stock ?? product.min_stock;
}
