import { db } from '../db';
import { getDeviceId, getMeta, setMeta } from '../meta';
import { enqueue } from '../outbox';
import { cartTotals, lineTotal, type Cart } from '@/services/cart';
import { nowISO, uuidv7 } from '@/services/id';
import type { PaymentDraft } from '@/services/payment';
import type { Payment, Sale, SaleItem, Store } from '@/types/domain';
import { chargeAccount, reverseCharge } from './accounts';
import { applyStockMovement } from './stock';

const TABLES = [db.sales, db.sale_items, db.payments, db.stock_movements, db.stock, db.meta, db.sync_queue, db.employee_accounts, db.account_movements];

export interface NewSale {
  /** Generado al abrir el cobro: un doble F1/F2 no puede duplicar la venta porque el id ya existe. */
  id: string;
  store: Pick<Store, 'id' | 'code'>;
  userId: string | null;
  cart: Cart;
  payments: PaymentDraft[];
}

export interface SaleDetail {
  sale: Sale;
  items: SaleItem[];
  payments: Payment[];
}

/**
 * Sucursal + últimos 4 del id del dispositivo + secuencia local.
 * Único sin coordinar con nadie, aunque dos cajas vendan sin Internet.
 */
function saleNumber(storeCode: string, deviceId: string, seq: number): string {
  return `${storeCode}-${deviceId.slice(-4).toUpperCase()}-${String(seq).padStart(6, '0')}`;
}

/** La venta, sus pagos, el stock y la cola de sincronización se confirman juntos o no se confirma nada. */
export async function createSale({ id, store, userId, cart, payments }: NewSale): Promise<SaleDetail> {
  if (cart.lines.length === 0) throw new Error('La venta no tiene productos');
  const deviceId = await getDeviceId();
  const totals = cartTotals(cart);
  const now = nowISO();

  return db.transaction('rw', TABLES, async () => {
    const seqKey = `sale_seq:${store.id}`;
    const seq = ((await getMeta<number>(seqKey)) ?? 0) + 1;
    await setMeta(seqKey, seq);

    const sale: Sale = {
      id,
      store_id: store.id,
      device_id: deviceId,
      user_id: userId,
      number: saleNumber(store.code, deviceId, seq),
      status: 'completed',
      subtotal_cents: totals.subtotal,
      discount_cents: totals.discount,
      total_cents: totals.total,
      occurred_at: now,
      voided_at: null,
      voided_by: null,
      void_reason: null,
      created_at: now,
      updated_at: now,
      version: 1,
      updated_by_device: deviceId,
    };
    await db.sales.add(sale);
    await enqueue('sales', sale.id, 'upsert', sale);

    const items: SaleItem[] = [];
    for (const [i, l] of cart.lines.entries()) {
      const item: SaleItem = {
        id: uuidv7(),
        sale_id: sale.id,
        line: i + 1,
        product_id: l.product_id,
        barcode: l.barcode,
        description: l.name,
        quantity: l.quantity,
        unit_price_cents: l.unit_price_cents,
        unit_cost_cents: l.unit_cost_cents,
        discount_cents: 0,
        total_cents: lineTotal(l),
      };
      await db.sale_items.add(item);
      await enqueue('sale_items', item.id, 'upsert', item);
      await applyStockMovement({
        id: uuidv7(),
        store_id: store.id,
        product_id: l.product_id,
        type: 'sale',
        quantity: -l.quantity,
        unit_cost_cents: l.unit_cost_cents,
        reason: null,
        reference_type: 'sale',
        reference_id: sale.id,
        user_id: userId,
        device_id: deviceId,
        occurred_at: now,
      });
      items.push(item);
    }

    const rows: Payment[] = payments.map((p) => ({ ...p, id: uuidv7(), sale_id: sale.id, occurred_at: now }));
    for (const p of rows) {
      await db.payments.add(p);
      await enqueue('payments', p.id, 'upsert', p);
      if (p.account_id) {
        await chargeAccount({ accountId: p.account_id, amount: p.amount_cents, saleId: sale.id, storeId: store.id, userId, deviceId });
      }
    }

    return { sale, items, payments: rows };
  });
}

/** Anular no borra nada: marca la venta y devuelve el stock con movimientos compensatorios. */
export async function voidSale(saleId: string, userId: string | null, reason: string): Promise<void> {
  if (!reason.trim()) throw new Error('Indicá el motivo de la anulación');
  const deviceId = await getDeviceId();
  const now = nowISO();

  await db.transaction('rw', TABLES, async () => {
    const sale = await db.sales.get(saleId);
    if (!sale) throw new Error('La venta no existe');
    if (sale.status === 'voided') throw new Error('La venta ya está anulada');

    const voided: Sale = {
      ...sale,
      status: 'voided',
      voided_at: now,
      voided_by: userId,
      void_reason: reason.trim(),
      updated_at: now,
      version: sale.version + 1,
      updated_by_device: deviceId,
    };
    await db.sales.put(voided);
    await enqueue('sales', sale.id, 'upsert', voided);

    const payments = await db.payments.where('sale_id').equals(saleId).toArray();
    for (const p of payments) {
      if (p.account_id) await reverseCharge({ accountId: p.account_id, amount: p.amount_cents, saleId, storeId: sale.store_id, userId, deviceId });
    }

    const items = await db.sale_items.where('sale_id').equals(saleId).toArray();
    for (const item of items) {
      if (!item.product_id) continue;
      await applyStockMovement({
        id: uuidv7(),
        store_id: sale.store_id,
        product_id: item.product_id,
        type: 'sale_void',
        quantity: item.quantity,
        unit_cost_cents: item.unit_cost_cents,
        reason: reason.trim(),
        reference_type: 'sale',
        reference_id: sale.id,
        user_id: userId,
        device_id: deviceId,
        occurred_at: now,
      });
    }
  });
}

export function dayRange(date: Date = new Date()): [string, string] {
  const from = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const to = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return [from.toISOString(), to.toISOString()];
}

export async function listSales(storeId: string, from: string, to: string): Promise<Sale[]> {
  const rows = await db.sales.where('[store_id+occurred_at]').between([storeId, from], [storeId, to], true, false).toArray();
  return rows.reverse();
}

export async function getSaleDetail(id: string): Promise<SaleDetail | null> {
  const sale = await db.sales.get(id);
  if (!sale) return null;
  const [items, payments] = await Promise.all([db.sale_items.where('sale_id').equals(id).sortBy('line'), db.payments.where('sale_id').equals(id).toArray()]);
  return { sale, items, payments };
}

/** Las ventas anuladas no suman. `cash` es sólo lo cobrado en efectivo: sin vuelto y sin tarjetas. */
export async function daySummary(storeId: string, date: Date = new Date()) {
  const [from, to] = dayRange(date);
  const completed = (await listSales(storeId, from, to)).filter((s) => s.status === 'completed');
  const payments = await db.payments.where('sale_id').anyOf(completed.map((s) => s.id)).toArray();
  const byMethod = (method: Payment['method']) => payments.filter((p) => p.method === method).reduce((sum, p) => sum + p.amount_cents, 0);
  return {
    tickets: completed.length,
    total: completed.reduce((sum, s) => sum + s.total_cents, 0),
    cash: byMethod('cash'),
    card: byMethod('card'),
    transfer: byMethod('transfer'),
    account: byMethod('employee_account'),
  };
}
