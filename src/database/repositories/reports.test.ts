import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { addLine, cartTotals, EMPTY_CART, type Cart } from '@/services/cart';
import { computePayment } from '@/services/payment';
import { uuidv7 } from '@/services/id';
import { ensureCategory, setCategoryPerishable } from './categories';
import { saveProduct, type ProductInput } from './products';
import { salesLines, salesReport, slowMovers } from './reports';
import { createSale, voidSale } from './sales';
import { applyStockMovement } from './stock';

const store = { id: 'store-1', code: 'ORO' };
const base: ProductInput = { name: 'Fernet', brand: null, sku: null, category_id: null, unit: 'unit', cost_cents: 600, price_cents: 1000, min_stock: 0, auto_min_stock: true, active: true, barcodes: [] };

const cartFor = (id: string, name: string, price: number, cost: number): Cart =>
  addLine(EMPTY_CART, { product_id: id, name, barcode: null, unit: 'unit', unit_price_cents: price, unit_cost_cents: cost });

const sell = (cart: Cart, method: 'cash' | 'card' = 'cash') =>
  createSale({ id: uuidv7(), store, userId: 'u1', cart, payments: computePayment(method, cartTotals(cart).total, null).payments });

/** Carga stock con fecha: así se simula mercadería que entró hace tiempo. */
const load = (productId: string, qty: number, daysAgo: number) =>
  db.transaction('rw', [db.stock, db.stock_movements, db.sync_queue], () =>
    applyStockMovement({
      id: uuidv7(),
      store_id: store.id,
      product_id: productId,
      type: 'initial',
      quantity: qty,
      unit_cost_cents: null,
      reason: null,
      reference_type: null,
      reference_id: null,
      user_id: null,
      device_id: 'd',
      occurred_at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    }),
  );

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('reportes de ventas', () => {
  it('suma ventas, ganancia, medios de pago y más vendidos sin contar anuladas', async () => {
    const fernet = await saveProduct(base);
    const vino = await saveProduct({ ...base, name: 'Vino', cost_cents: 300, price_cents: 500 });
    await sell(cartFor(fernet.id, 'Fernet', 1000, 600));
    await sell(cartFor(vino.id, 'Vino', 500, 300), 'card');
    const voided = await sell(cartFor(vino.id, 'Vino', 500, 300));
    await voidSale(voided.sale.id, 'u1', 'Error');

    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 86_400_000).toISOString();
    const r = await salesReport(store.id, from, to);
    expect(r.total).toBe(1500);
    expect(r.tickets).toBe(2);
    expect(r.cost).toBe(900);
    expect(r.voided).toEqual({ count: 1, total: 500 });
    expect(r.byMethod).toEqual({ cash: 1000, card: 500 });
    expect(r.byProduct.map((p) => [p.label, p.quantity, p.total])).toEqual([
      ['Fernet', 1, 1000],
      ['Vino', 1, 500],
    ]);
    expect(r.byHour.reduce((t, h) => t + h.tickets, 0)).toBe(2);

    const lines = await salesLines(store.id, from, to, (m) => m.toUpperCase());
    expect(lines.map((l) => [l.product, l.quantity, l.total, l.cost, l.methods])).toEqual([
      ['Fernet', 1, 1000, 600, 'CASH'],
      ['Vino', 1, 500, 300, 'CARD'],
    ]);
  });
});

describe('poca rotación', () => {
  it('lista lo que tiene stock y no se vende, marca los comestibles y deja afuera lo recién cargado', async () => {
    const food = await ensureCategory('Snacks');
    await setCategoryPerishable(food.id, true);
    const papas = await saveProduct({ ...base, name: 'Papas', category_id: food.id });
    const fernet = await saveProduct({ ...base, name: 'Fernet' });
    const nuevo = await saveProduct({ ...base, name: 'Nuevo' });
    const vendido = await saveProduct({ ...base, name: 'Vendido' });
    await load(papas.id, 5, 60);
    await load(fernet.id, 5, 45);
    await load(nuevo.id, 5, 2);
    await load(vendido.id, 5, 60);
    await sell(cartFor(vendido.id, 'Vendido', 1000, 600));

    const rows = await slowMovers(store.id, 30);
    expect(rows.map((r) => r.name)).toEqual(['Papas', 'Fernet']);
    expect(rows[0]).toMatchObject({ perishable: true, stock: 5, sold: 0, idleDays: 60 });
    expect(rows[1]?.perishable).toBe(false);

    // Con "1 vendido o menos" también aparece el que se vendió una vez.
    expect((await slowMovers(store.id, 30, 1)).map((r) => r.name)).toContain('Vendido');
  });
});
