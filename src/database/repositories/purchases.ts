import { db } from '../db';
import { getDeviceId } from '../meta';
import { enqueue, newMeta, touchMeta } from '../outbox';
import { nowISO, uuidv7 } from '@/services/id';
import type { InvoiceType, Purchase, PurchaseItem, UUID } from '@/types/domain';
import { recordCost } from './costs';
import { toSyncProduct } from './products';
import { applyStockMovement } from './stock';

const TABLES = [db.purchases, db.purchase_items, db.purchase_files, db.products, db.product_cost_history, db.stock, db.stock_movements, db.sync_queue];

export class PurchaseError extends Error {}

export interface PurchaseLineInput {
  product_id: UUID;
  quantity: number;
  unit_cost_cents: number;
}

export interface PurchaseInput {
  store_id: UUID;
  supplier_id: UUID | null;
  invoice_type: InvoiceType | null;
  invoice_number: string | null;
  invoice_date: string | null;
  notes: string | null;
  lines: PurchaseLineInput[];
  /** undefined = sin cambios; null = quitar la foto; Blob = reemplazar. */
  invoice_file?: Blob | null;
}

export interface PurchaseDetail {
  purchase: Purchase;
  items: PurchaseItem[];
  file: Blob | null;
}

/**
 * Guarda el borrador y, si `receive` es true, lo recibe en la misma transacción:
 * suma el stock, actualiza el costo del producto y registra el costo histórico. El precio de venta no se toca.
 */
export async function savePurchase(input: PurchaseInput, opts: { id?: string | undefined; receive: boolean; userId: UUID | null }): Promise<Purchase> {
  if (input.lines.length === 0) throw new PurchaseError('Agregá al menos un producto');
  for (const l of input.lines) {
    if (!(l.quantity > 0)) throw new PurchaseError('Todas las cantidades tienen que ser mayores a cero');
    if (!(l.unit_cost_cents >= 0)) throw new PurchaseError('Revisá los costos: hay uno inválido');
  }
  if (opts.receive && !input.supplier_id) throw new PurchaseError('Elegí el proveedor para recibir la compra');
  const number = input.invoice_number?.trim() || null;
  const deviceId = await getDeviceId();
  const now = nowISO();

  return db.transaction('rw', TABLES, async () => {
    const previous = opts.id ? await db.purchases.get(opts.id) : undefined;
    if (previous && previous.status !== 'draft') throw new PurchaseError('Esta compra ya no se puede modificar');

    if (number && input.supplier_id) {
      const dup = await db.purchases
        .where('supplier_id')
        .equals(input.supplier_id)
        .filter((p) => p.invoice_number === number && p.invoice_type === input.invoice_type && p.status !== 'cancelled' && p.id !== opts.id)
        .first();
      if (dup) throw new PurchaseError(`La factura ${number} de este proveedor ya está cargada`);
    }

    const id = previous?.id ?? uuidv7();
    const subtotal = input.lines.reduce((sum, l) => sum + Math.round(l.quantity * l.unit_cost_cents), 0);
    const fields = {
      store_id: input.store_id,
      supplier_id: input.supplier_id,
      status: opts.receive ? ('received' as const) : ('draft' as const),
      invoice_type: input.invoice_type,
      invoice_number: number,
      invoice_date: input.invoice_date || null,
      invoice_path: previous?.invoice_path ?? null,
      subtotal_cents: subtotal,
      tax_cents: 0,
      total_cents: subtotal,
      received_at: opts.receive ? now : null,
      received_by: opts.receive ? opts.userId : null,
      notes: input.notes?.trim() || null,
    };
    const purchase: Purchase = previous ? { ...touchMeta(previous, deviceId), ...fields } : { id, ...newMeta(deviceId), ...fields };
    await db.purchases.put(purchase);
    await enqueue('purchases', id, 'upsert', purchase);

    // Las líneas del borrador se reemplazan enteras.
    const oldItems = await db.purchase_items.where('purchase_id').equals(id).toArray();
    for (const old of oldItems) {
      await db.purchase_items.delete(old.id);
      await enqueue('purchase_items', old.id, 'delete', { id: old.id });
    }

    for (const l of input.lines) {
      const item: PurchaseItem = {
        id: uuidv7(),
        purchase_id: id,
        product_id: l.product_id,
        quantity: l.quantity,
        unit_cost_cents: l.unit_cost_cents,
        total_cents: Math.round(l.quantity * l.unit_cost_cents),
        updated_at: now,
      };
      await db.purchase_items.add(item);
      await enqueue('purchase_items', item.id, 'upsert', item);

      if (opts.receive) {
        await applyStockMovement({
          id: uuidv7(),
          store_id: input.store_id,
          product_id: l.product_id,
          type: 'purchase',
          quantity: l.quantity,
          unit_cost_cents: l.unit_cost_cents,
          reason: null,
          reference_type: 'purchase',
          reference_id: id,
          user_id: opts.userId,
          device_id: deviceId,
          occurred_at: now,
        });
        const product = await db.products.get(l.product_id);
        if (product && product.cost_cents !== l.unit_cost_cents) {
          const updated = { ...touchMeta(product, deviceId), cost_cents: l.unit_cost_cents };
          await db.products.put(updated);
          await enqueue('products', product.id, 'upsert', toSyncProduct(updated));
          await recordCost(product.id, l.unit_cost_cents, deviceId, { supplierId: input.supplier_id, purchaseId: id });
        }
      }
    }

    if (input.invoice_file === null) await db.purchase_files.delete(id);
    else if (input.invoice_file) await db.purchase_files.put({ purchase_id: id, blob: input.invoice_file, updated_at: now });

    return purchase;
  });
}

export async function cancelPurchase(id: string): Promise<void> {
  const deviceId = await getDeviceId();
  await db.transaction('rw', db.purchases, db.sync_queue, async () => {
    const p = await db.purchases.get(id);
    if (!p) return;
    if (p.status !== 'draft') throw new PurchaseError('Sólo se puede cancelar un borrador');
    const cancelled: Purchase = { ...touchMeta(p, deviceId), status: 'cancelled' };
    await db.purchases.put(cancelled);
    await enqueue('purchases', id, 'upsert', cancelled);
  });
}

export async function listPurchases(storeId: UUID, limit = 100): Promise<Purchase[]> {
  return db.purchases.where('[store_id+created_at]').between([storeId, ''], [storeId, '￿']).reverse().limit(limit).toArray();
}

export async function getPurchaseDetail(id: string): Promise<PurchaseDetail | null> {
  const purchase = await db.purchases.get(id);
  if (!purchase) return null;
  const [items, file] = await Promise.all([db.purchase_items.where('purchase_id').equals(id).toArray(), db.purchase_files.get(id)]);
  return { purchase, items, file: file?.blob ?? null };
}
