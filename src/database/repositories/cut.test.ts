import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { addCommonLine, addLine, cartTotals, EMPTY_CART, type Cart } from '@/services/cart';
import { computePayment } from '@/services/payment';
import { uuidv7 } from '@/services/id';
import { addCashMovement, closeSession } from './cash';
import { ensureCategory } from './categories';
import { dailyCut, recentShifts, shiftCut } from './cut';
import { localDay } from './reports';
import { saveProduct, type ProductInput } from './products';
import { createSale } from './sales';

const store = { id: 'store-1', code: 'ORO' };
const base: ProductInput = { name: 'Fernet', brand: null, sku: null, category_id: null, unit: 'unit', cost_cents: 600, price_cents: 1000, min_stock: 0, auto_min_stock: true, active: true, barcodes: [] };
const cartFor = (id: string, name: string, price: number, cost: number): Cart =>
  addLine(EMPTY_CART, { product_id: id, name, barcode: null, unit: 'unit', unit_price_cents: price, unit_cost_cents: cost });
const sell = (cart: Cart, userId: string, method: 'cash' | 'card' = 'cash') =>
  createSale({ id: uuidv7(), store, userId, cart, payments: computePayment(method, cartTotals(cart).total, null).payments });

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('corte del día', () => {
  it('suma ventas, medios de pago, retiros, categorías y ganancia, de todos o de un cajero', async () => {
    const bebidas = await ensureCategory('Bebidas');
    const fernet = await saveProduct({ ...base, category_id: bebidas.id });
    const vino = await saveProduct({ ...base, name: 'Vino', cost_cents: 300, price_cents: 500 });
    const first = await sell(cartFor(fernet.id, 'Fernet', 1000, 600), 'ana');
    await sell(cartFor(vino.id, 'Vino', 500, 300), 'ana', 'card');
    await sell(addCommonLine(EMPTY_CART, 'Varios', 200, 'x'), 'beto');
    await addCashMovement({ sessionId: first.sale.cash_session_id!, type: 'withdrawal', amount: 300, reason: 'Proveedor', userId: 'ana' });

    const all = await dailyCut(store.id, localDay(new Date()), null);
    expect(all.salesTotal).toBe(1700);
    expect(all.byMethod).toEqual({ cash: 1200, card: 500 });
    expect(all.paidNow).toBe(1700);
    expect([all.cashSales, all.withdrawals, all.cashInDrawer, all.tickets]).toEqual([1200, 300, 900, 3]);
    expect(all.byCategory).toEqual([
      { label: 'Bebidas', total: 1000 },
      { label: 'Sin categoría', total: 500 },
      { label: 'Productos comunes', total: 200 },
    ]);
    expect(all.profit).toBe(600);

    const ana = await dailyCut(store.id, localDay(new Date()), 'ana');
    expect([ana.salesTotal, ana.cashInDrawer, ana.movements.length]).toEqual([1500, 700, 1]);
    const beto = await dailyCut(store.id, localDay(new Date()), 'beto');
    expect([beto.salesTotal, beto.cashInDrawer, beto.movements.length]).toEqual([200, 200, 0]);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect((await dailyCut(store.id, localDay(yesterday), null)).salesTotal).toBe(0);
  });
});

describe('corte por turno', () => {
  it('un turno que pasa la medianoche queda entero, con lo que contó el cajero', async () => {
    const p = await saveProduct(base);
    const s1 = await sell(cartFor(p.id, 'Fernet', 1000, 600), 'vicky');
    const s2 = await sell(cartFor(p.id, 'Fernet', 500, 300), 'vicky', 'card');
    const shift = s1.sale.cash_session_id!;
    const w = await addCashMovement({ sessionId: shift, type: 'withdrawal', amount: 300, reason: 'Hielo', userId: 'vicky' });
    await closeSession(shift, 650, 'vicky');
    const s3 = await sell(cartFor(p.id, 'Fernet', 200, 100), 'beto');
    expect(s3.sale.cash_session_id).not.toBe(shift);

    // Vicky trabajó del 17 a las 22 al 18 a las 2; Beto entró el 18 a las 10.
    const iso = (s: string) => new Date(s).toISOString();
    await db.cash_sessions.update(shift, { opened_at: iso('2026-11-17T22:00:00'), closed_at: iso('2026-11-18T02:00:00') });
    await db.cash_sessions.update(s3.sale.cash_session_id!, { opened_at: iso('2026-11-18T10:00:00') });
    await db.sales.update(s1.sale.id, { occurred_at: iso('2026-11-17T23:00:00') });
    await db.sales.update(s2.sale.id, { occurred_at: iso('2026-11-18T01:00:00') });
    await db.sales.update(s3.sale.id, { occurred_at: iso('2026-11-18T10:30:00') });
    await db.cash_movements.update(w.id, { occurred_at: iso('2026-11-18T00:30:00') });

    const vicky = (await shiftCut(shift))!;
    expect([vicky.salesTotal, vicky.tickets, vicky.cashSales, vicky.withdrawals, vicky.cashInDrawer, vicky.counted]).toEqual([1500, 2, 1000, 300, 700, 650]);
    expect(vicky.byMethod).toEqual({ cash: 1000, card: 500 });
    const beto = (await shiftCut(s3.sale.cash_session_id!))!;
    expect([beto.salesTotal, beto.counted]).toEqual([200, null]);

    // Por día, en cambio, el turno de Vicky queda partido en dos.
    expect((await dailyCut(store.id, '2026-11-17', null)).salesTotal).toBe(1000);
    expect((await dailyCut(store.id, '2026-11-18', null)).salesTotal).toBe(700);
    expect((await recentShifts(store.id, 100000)).map((s) => s.id)).toEqual([s3.sale.cash_session_id, shift]);
  });
});
