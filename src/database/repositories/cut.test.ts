import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { addCommonLine, addLine, cartTotals, EMPTY_CART, type Cart } from '@/services/cart';
import { computePayment } from '@/services/payment';
import { uuidv7 } from '@/services/id';
import { addCashMovement } from './cash';
import { ensureCategory } from './categories';
import { dailyCut } from './cut';
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
