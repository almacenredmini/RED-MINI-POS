import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { addCommonLine, addLine, cartTotals, changeQuantity, EMPTY_CART, type Cart } from '@/services/cart';
import { computePayment } from '@/services/payment';
import { uuidv7 } from '@/services/id';
import { cashSummary } from './cash';
import { saveProduct } from './products';
import { salesReport } from './reports';
import { createSale, daySummary, returnSaleItem, voidSale } from './sales';

const store = { id: 'store-1', code: 'ORO' };

const sell = (cart: Cart) => createSale({ id: uuidv7(), store, userId: 'u1', cart, payments: computePayment('cash', cartTotals(cart).total, null).payments });

const product = (name: string, stock: number) =>
  saveProduct({
    name,
    brand: null,
    sku: null,
    category_id: null,
    unit: 'unit',
    cost_cents: 500,
    price_cents: 1000,
    min_stock: 0,
    auto_min_stock: false,
    active: true,
    barcodes: [],
    stock_adjustment: { store_id: store.id, user_id: null, quantity: stock },
  });

const lineOf = (p: { id: string; name: string }) => ({ product_id: p.id, name: p.name, barcode: null, unit: 'unit' as const, unit_price_cents: 1000, unit_cost_cents: 500 });
const stockOf = async (id: string) => (await db.stock.get(`${store.id}:${id}`))?.quantity;
const giveBack = (saleItemId: string, quantity: number) => returnSaleItem({ saleItemId, quantity, reason: 'fallado', storeId: store.id, userId: 'u2' });

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('devoluciones', () => {
  it('devuelve parte de un ítem: vuelve el stock y sale efectivo de la caja', async () => {
    const fernet = await product('Fernet', 10);
    const { sale, items } = await sell(changeQuantity(addLine(EMPTY_CART, lineOf(fernet)), fernet.id, 2));
    expect(await stockOf(fernet.id)).toBe(7);

    const r = await giveBack(items[0]!.id, 1);
    expect(r.total_cents).toBe(1000);
    expect(r.refund_method).toBe('cash');
    expect(await stockOf(fernet.id)).toBe(8);

    const cash = await cashSummary(sale.cash_session_id!);
    expect(cash!.expected).toBe(2000);
    expect(cash!.returns).toEqual({ count: 1, total: 1000, cash: 1000 });

    const day = await daySummary(store.id);
    expect(day.total).toBe(2000);
    expect(day.cash).toBe(2000);
  });

  it('no deja devolver más de lo vendido', async () => {
    const fernet = await product('Fernet', 10);
    const { items } = await sell(addLine(EMPTY_CART, lineOf(fernet)));
    await giveBack(items[0]!.id, 1);
    await expect(giveBack(items[0]!.id, 1)).rejects.toThrow('ya se devolvió');
  });

  it('devuelve lo que pagó, con su parte del descuento', async () => {
    const fernet = await product('Fernet', 10);
    const cart: Cart = { ...addLine(addLine(EMPTY_CART, lineOf(fernet)), lineOf(fernet)), discount: { type: 'pct', value: 10 } };
    const { items } = await sell(cart);
    expect((await giveBack(items[0]!.id, 1)).total_cents).toBe(900);
  });

  it('resta en los reportes del día y en el producto', async () => {
    const fernet = await product('Fernet', 10);
    const { items } = await sell(addCommonLine(changeQuantity(addLine(EMPTY_CART, lineOf(fernet)), fernet.id, 2), 'Hielo', 500, 'c1'));
    await giveBack(items[0]!.id, 1);
    await giveBack(items[1]!.id, 1); // el común: no entra en los totales

    const r = await salesReport(null, '2000-01-01', '2100-01-01');
    expect(r.total).toBe(2000);
    expect(r.cost).toBe(1000);
    expect(r.returns).toEqual({ count: 1, total: 1000 });
    expect(r.byProduct[0]).toMatchObject({ quantity: 2, total: 2000 });
    expect(r.common.total).toBe(0);
    expect(r.byMethod.cash).toBe(2000);
  });

  it('un ticket con devoluciones no se puede cancelar', async () => {
    const fernet = await product('Fernet', 10);
    const { sale, items } = await sell(changeQuantity(addLine(EMPTY_CART, lineOf(fernet)), fernet.id, 1));
    await giveBack(items[0]!.id, 1);
    await expect(voidSale(sale.id, 'u2', 'error')).rejects.toThrow('devoluciones');
  });

  it('un ticket cancelado no admite devoluciones', async () => {
    const fernet = await product('Fernet', 10);
    const { sale, items } = await sell(addLine(EMPTY_CART, lineOf(fernet)));
    await voidSale(sale.id, 'u2', 'error');
    await expect(giveBack(items[0]!.id, 1)).rejects.toThrow('cancelado');
  });
});
