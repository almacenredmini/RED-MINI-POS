import { db } from '../db';
import { enqueue, enqueueMany } from '../outbox';
import { nowISO } from '@/services/id';
import type { StockMovement } from '@/types/domain';
import { stockKey } from './stores';

/**
 * Única puerta de escritura del stock: registra el movimiento y actualiza la proyección.
 * Debe llamarse dentro de una transacción que incluya stock, stock_movements y sync_queue.
 * El stock puede quedar negativo: una venta nunca se frena por una diferencia de inventario.
 */
export async function applyStockMovement(movement: StockMovement): Promise<void> {
  await db.stock_movements.add(movement);
  const id = stockKey(movement.store_id, movement.product_id);
  const current = await db.stock.get(id);
  await db.stock.put({
    id,
    store_id: movement.store_id,
    product_id: movement.product_id,
    quantity: (current?.quantity ?? 0) + movement.quantity,
    updated_at: nowISO(),
  });
  await enqueue('stock_movements', movement.id, 'upsert', movement);
}

/** Lo mismo para cargas masivas. */
export async function applyStockMovements(movements: StockMovement[]): Promise<void> {
  if (movements.length === 0) return;
  await writeMovements(movements);
  await enqueueMany(movements.map((m) => ({ table: 'stock_movements' as const, record_id: m.id, op: 'upsert' as const, payload: m })));
}

/**
 * Movimientos que llegan de otro dispositivo: suman al stock sin volver a encolarse.
 * Los que ya estaban (por ejemplo, los propios de vuelta del servidor) se ignoran para no contarlos dos veces.
 */
export async function applyRemoteStockMovements(movements: StockMovement[]): Promise<void> {
  if (movements.length === 0) return;
  const existing = await db.stock_movements.bulkGet(movements.map((m) => m.id));
  const seen = new Set<string>();
  const fresh = movements.filter((m, i) => {
    if (existing[i] || seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
  if (fresh.length > 0) await writeMovements(fresh);
}

async function writeMovements(movements: StockMovement[]): Promise<void> {
  const ids = [...new Set(movements.map((m) => stockKey(m.store_id, m.product_id)))];
  const rows = await db.stock.bulkGet(ids);
  const quantities = new Map(ids.map((id, i) => [id, rows[i]?.quantity ?? 0]));
  const now = nowISO();

  for (const m of movements) {
    const id = stockKey(m.store_id, m.product_id);
    quantities.set(id, (quantities.get(id) ?? 0) + m.quantity);
  }
  await db.stock_movements.bulkAdd(movements);
  const seen = new Set<string>();
  const levels = movements.flatMap((m) => {
    const id = stockKey(m.store_id, m.product_id);
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ id, store_id: m.store_id, product_id: m.product_id, quantity: quantities.get(id) ?? 0, updated_at: now }];
  });
  await db.stock.bulkPut(levels);
}
