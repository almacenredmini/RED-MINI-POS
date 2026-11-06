import { db } from '../db';
import { getDeviceId } from '../meta';
import { nowISO, uuidv7 } from '@/services/id';
import type { Product, StockMovement, UUID } from '@/types/domain';
import { applyStockMovement } from './stock';
import { stockKey } from './stores';

const TABLES = [db.stock, db.stock_movements, db.sync_queue];

export type ManualKind = 'entry' | 'exit' | 'count';

export class InventoryError extends Error {}

interface ManualMovement {
  kind: ManualKind;
  storeId: UUID;
  product: Pick<Product, 'id' | 'cost_cents'>;
  /** Entrada/salida: unidades a mover. Conteo: cantidad real que hay en el local. */
  quantity: number;
  reason: string;
  userId: UUID | null;
}

const DEFAULT_REASON: Record<ManualKind, string> = { entry: 'Entrada manual', exit: 'Salida manual', count: 'Conteo de stock' };

export async function registerManualMovement({ kind, storeId, product, quantity, reason, userId }: ManualMovement): Promise<number> {
  if (!Number.isFinite(quantity)) throw new InventoryError('Ingresá una cantidad válida');
  if (kind !== 'count' && quantity <= 0) throw new InventoryError('La cantidad tiene que ser mayor a cero');
  if (kind === 'exit' && !reason.trim()) throw new InventoryError('Indicá el motivo de la salida');
  const deviceId = await getDeviceId();

  return db.transaction('rw', TABLES, async () => {
    const current = (await db.stock.get(stockKey(storeId, product.id)))?.quantity ?? 0;
    const delta = kind === 'entry' ? quantity : kind === 'exit' ? -quantity : quantity - current;
    if (delta === 0) throw new InventoryError('La cantidad contada coincide con el stock: no hay nada que ajustar');

    await applyStockMovement({
      id: uuidv7(),
      store_id: storeId,
      product_id: product.id,
      type: 'adjustment',
      kind,
      quantity: delta,
      unit_cost_cents: product.cost_cents,
      reason: reason.trim() || DEFAULT_REASON[kind],
      reference_type: kind === 'count' ? 'count' : null,
      reference_id: null,
      user_id: userId,
      device_id: deviceId,
      occurred_at: nowISO(),
    });
    return current + delta;
  });
}

interface Transfer {
  fromStoreId: UUID;
  toStoreId: UUID;
  product: Pick<Product, 'id' | 'cost_cents'>;
  quantity: number;
  reason: string;
  userId: UUID | null;
}

/** La salida y la entrada comparten `transfer_id` y se guardan juntas: nunca queda stock "en el aire". */
export async function transferStock({ fromStoreId, toStoreId, product, quantity, reason, userId }: Transfer): Promise<void> {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new InventoryError('La cantidad tiene que ser mayor a cero');
  if (fromStoreId === toStoreId) throw new InventoryError('Elegí una sucursal de destino distinta');
  const deviceId = await getDeviceId();
  const transferId = uuidv7();
  const now = nowISO();
  const common = {
    product_id: product.id,
    unit_cost_cents: product.cost_cents,
    reason: reason.trim() || 'Transferencia entre sucursales',
    reference_type: 'transfer' as const,
    reference_id: transferId,
    transfer_id: transferId,
    user_id: userId,
    device_id: deviceId,
    occurred_at: now,
  };

  await db.transaction('rw', TABLES, async () => {
    await applyStockMovement({ ...common, id: uuidv7(), store_id: fromStoreId, type: 'transfer_out', quantity: -quantity });
    await applyStockMovement({ ...common, id: uuidv7(), store_id: toStoreId, type: 'transfer_in', quantity });
  });
}

export async function listMovements(storeId: UUID, productId: UUID | null, limit = 200): Promise<StockMovement[]> {
  if (productId) {
    const rows = await db.stock_movements.where('[store_id+product_id]').equals([storeId, productId]).toArray();
    return rows.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, limit);
  }
  const rows = await db.stock_movements
    .where('[store_id+occurred_at]')
    .between([storeId, ''], [storeId, '￿'])
    .reverse()
    .limit(limit)
    .toArray();
  return rows;
}

const MOVEMENT_LABELS: Record<StockMovement['type'], string> = {
  initial: 'Carga inicial',
  sale: 'Venta',
  sale_void: 'Venta anulada',
  purchase: 'Compra',
  purchase_return: 'Devolución a proveedor',
  adjustment: 'Ajuste',
  transfer_out: 'Transferencia enviada',
  transfer_in: 'Transferencia recibida',
};

const KIND_LABELS: Record<ManualKind, string> = { entry: 'Entrada', exit: 'Salida', count: 'Conteo' };

export function movementLabel(m: Pick<StockMovement, 'type' | 'kind'>): string {
  return m.type === 'adjustment' && m.kind ? KIND_LABELS[m.kind] : MOVEMENT_LABELS[m.type];
}

/** Stock positivo a costo actual. El stock negativo no resta: es una diferencia a corregir, no mercadería. */
export async function stockValuation(storeId: UUID): Promise<{ units: number; costCents: number }> {
  const rows = await db.stock.where('store_id').equals(storeId).toArray();
  const products = await db.products.bulkGet(rows.map((r) => r.product_id));
  let units = 0;
  let costCents = 0;
  rows.forEach((r, i) => {
    const p = products[i];
    if (!p || p.deleted_at || r.quantity <= 0) return;
    units += r.quantity;
    costCents += Math.round(r.quantity * p.cost_cents);
  });
  return { units, costCents };
}
