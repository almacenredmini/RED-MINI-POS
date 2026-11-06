import { db } from '../db';
import { enqueue } from '../outbox';
import { nowISO, uuidv7 } from '@/services/id';
import type { ProductCost } from '@/types/domain';

export function newCostRow(productId: string, costCents: number, deviceId: string, source: { supplierId?: string | null; purchaseId?: string | null } = {}): ProductCost {
  return {
    id: uuidv7(),
    product_id: productId,
    supplier_id: source.supplierId ?? null,
    purchase_id: source.purchaseId ?? null,
    cost_cents: costCents,
    effective_at: nowISO(),
    device_id: deviceId,
  };
}

/** Debe llamarse dentro de una transacción que incluya product_cost_history y sync_queue. */
export async function recordCost(productId: string, costCents: number, deviceId: string, source: { supplierId?: string | null; purchaseId?: string | null } = {}): Promise<void> {
  const row = newCostRow(productId, costCents, deviceId, source);
  await db.product_cost_history.add(row);
  await enqueue('product_cost_history', row.id, 'upsert', row);
}

export async function listProductCosts(productId: string, limit = 10): Promise<ProductCost[]> {
  const rows = await db.product_cost_history.where('product_id').equals(productId).toArray();
  return rows.sort((a, b) => b.effective_at.localeCompare(a.effective_at)).slice(0, limit);
}
