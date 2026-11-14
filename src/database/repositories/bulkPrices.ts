import { db } from '../db';
import { getDeviceId } from '../meta';
import { enqueue, touchMeta } from '../outbox';
import { logProductChange } from './productChanges';
import { toSyncProduct } from './products';
import type { UUID } from '@/types/domain';

export type PriceMode = 'percent' | 'amount';

export interface PriceRule {
  mode: PriceMode;
  /** Porcentaje (10 = +10 %) o monto en centavos. Negativo baja el precio. */
  value: number;
  /** Redondeo en centavos: 0 = sin redondeo, 1000 = a $10, 10000 = a $100. */
  rounding: number;
}

/** Precio nuevo según la regla. Nunca baja de $0,01: si el cálculo da 0 o menos, devuelve null (no se cambia). */
export function applyPriceRule(price: number, { mode, value, rounding }: PriceRule): number | null {
  let next = mode === 'percent' ? price * (1 + value / 100) : price + value;
  if (rounding > 0) next = Math.round(next / rounding) * rounding;
  next = Math.round(next);
  return next > 0 ? next : null;
}

/** Cambia el precio de varios productos de una vez. Queda registrado en el Reporte de movimientos. */
export async function bulkUpdatePrices(ids: UUID[], rule: PriceRule, userId: UUID | null): Promise<number> {
  const deviceId = await getDeviceId();
  return db.transaction('rw', [db.products, db.product_changes, db.sync_queue], async () => {
    let changed = 0;
    for (const product of await db.products.bulkGet(ids)) {
      if (!product || product.deleted_at) continue;
      const price = applyPriceRule(product.price_cents, rule);
      if (price === null || price === product.price_cents) continue;
      const updated = { ...touchMeta(product, deviceId), price_cents: price };
      await db.products.put(updated);
      await enqueue('products', updated.id, 'upsert', toSyncProduct(updated));
      await logProductChange(product, updated, { source: 'bulk_price', userId, deviceId });
      changed += 1;
    }
    return changed;
  });
}
