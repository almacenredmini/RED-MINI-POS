import { db } from '../db';
import { getMeta, setMeta } from '../meta';
import { nowISO } from '@/services/id';
import type { Product, StoreMinStock } from '@/types/domain';
import { listSales } from './sales';
import { getStockMap } from './stores';


/** 00:00 hora local del día de `date`. */
export function dayStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** El día que se usa para "lo que debería tener": el mismo día de la semana pasada (hoy lunes, el lunes anterior). */
export function minStockWindow(now: Date = new Date()): { from: Date; to: Date } {
  const today = dayStart(now);
  return {
    from: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7),
    to: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6),
  };
}

/**
 * Recalcula lo que debería tener cada producto de una sucursal: lo que se vendió el mismo día de la semana
 * pasada, que es lo que se espera vender hoy. Se recalcula todos los días.
 */
export async function recalcMinStock(storeId: string, now: Date = new Date()): Promise<void> {
  const { from, to } = minStockWindow(now);

  const sales = (await listSales(storeId, from.toISOString(), to.toISOString())).filter((s) => s.status === 'completed');
  const items = await db.sale_items.where('sale_id').anyOf(sales.map((s) => s.id)).toArray();

  const sold = new Map<string, number>();
  for (const i of items) {
    if (i.product_id) sold.set(i.product_id, (sold.get(i.product_id) ?? 0) + i.quantity);
  }

  const computedAt = nowISO();
  const rows: StoreMinStock[] = [...sold].map(([productId, units]) => ({
    id: `${storeId}:${productId}`,
    store_id: storeId,
    product_id: productId,
    // Se redondea para arriba: medio kilo vendido pide tener al menos 1.
    min_stock: Math.ceil(units),
    weekly_avg: units,
    computed_at: computedAt,
  }));

  await db.transaction('rw', db.store_min_stock, db.meta, async () => {
    await db.store_min_stock.where('store_id').equals(storeId).delete();
    await db.store_min_stock.bulkPut(rows);
    await setMeta(dayKey(storeId), dayStart(now).toISOString());
  });
}

const dayKey = (storeId: string) => `min_stock_day:${storeId}`;

/** Se ejecuta al entrar a la sucursal y cada tanto con la app abierta: recalcula una vez por día. */
export async function recalcMinStockIfNewDay(storeId: string, now: Date = new Date()): Promise<void> {
  const last = await getMeta<string>(dayKey(storeId));
  if (last !== dayStart(now).toISOString()) await recalcMinStock(storeId, now);
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

export interface Shortage {
  product: Product;
  /** Lo que debería haber: lo vendido el mismo día de la semana pasada, o el mínimo cargado a mano. */
  should: number;
  have: number;
  missing: number;
  /** true = sale de las ventas de ese día; false = mínimo cargado a mano. */
  fromSales: boolean;
}

/** Todo lo que falta en la sucursal: productos con menos stock del que deberían tener, lo que más falta primero. */
export async function listShortages(storeId: string): Promise<Shortage[]> {
  const [products, stock, auto] = await Promise.all([
    db.products.filter((p) => !p.deleted_at && p.active && p.track_stock !== false).toArray(),
    getStockMap(storeId),
    getAutoMinMap(storeId),
  ]);
  return products
    .map((p) => {
      const should = effectiveMinStock(p, auto);
      const have = stock.get(p.id) ?? 0;
      return { product: p, should, have, missing: should - have, fromSales: p.auto_min_stock && auto.has(p.id) };
    })
    .filter((s) => s.should > 0 && s.missing > 0)
    .sort((a, b) => b.missing - a.missing || a.product.name.localeCompare(b.product.name, 'es'));
}
