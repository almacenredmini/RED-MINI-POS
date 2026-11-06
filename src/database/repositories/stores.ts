import { db } from '../db';
import type { Store } from '@/types/domain';

export async function listStores(): Promise<Store[]> {
  const all = await db.stores.orderBy('code').toArray();
  return all.filter((s) => s.active && !s.deleted_at);
}

export function stockKey(storeId: string, productId: string): string {
  return `${storeId}:${productId}`;
}

/** Sólo lectura en Etapa 1. Las escrituras de stock pasan por movimientos (Etapa 3). */
export async function getStockMap(storeId: string): Promise<Map<string, number>> {
  const rows = await db.stock.where('store_id').equals(storeId).toArray();
  return new Map(rows.map((r) => [r.product_id, r.quantity]));
}
