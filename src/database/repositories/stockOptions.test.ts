import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { addCommonLine, addLine, cartTotals, EMPTY_CART, type Cart } from '@/services/cart';
import { computePayment } from '@/services/payment';
import { uuidv7 } from '@/services/id';
import { InventoryError, registerManualMovement, stockValuation } from './inventory';
import { saveProduct } from './products';
import { salesReport, stockValue } from './reports';
import { createSale, voidSale } from './sales';

const store = { id: 'store-1', code: 'ORO' };

const sell = (cart: Cart) => createSale({ id: uuidv7(), store, userId: 'u1', cart, payments: computePayment('cash', cartTotals(cart).total, null).payments });

const product = (name: string, track_stock: boolean, stock = 0) =>
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
    track_stock,
    ...(stock ? { stock_adjustment: { store_id: store.id, user_id: null, quantity: stock } } : {}),
  });

const lineOf = (p: { id: string; name: string }) => ({ product_id: p.id, name: p.name, barcode: null, unit: 'unit' as const, unit_price_cents: 1000, unit_cost_cents: 500 });

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('producto común', () => {
  it('se cobra y queda en la venta sin producto, sin tocar el stock', async () => {
    const fernet = await product('Fernet', true, 10);
    const cart = addCommonLine(addLine(EMPTY_CART, lineOf(fernet)), 'Hielo', 1500, 'x1');
    const { sale, items } = await sell(cart);

    expect(sale.total_cents).toBe(2500);
    expect(items.map((i) => [i.description, i.product_id])).toEqual([
      ['Fernet', fernet.id],
      ['Hielo', null],
    ]);
    const moves = (await db.stock_movements.toArray()).filter((m) => m.type === 'sale');
    expect(moves.map((m) => m.product_id)).toEqual([fernet.id]);
  });

  it('no entra en los reportes, pero se informa aparte', async () => {
    const fernet = await product('Fernet', true);
    await sell(addCommonLine(addLine(EMPTY_CART, lineOf(fernet)), 'Hielo', 1500, 'x1'));
    await sell(addCommonLine(EMPTY_CART, 'Carbón', 3000, 'x2'));

    const r = await salesReport(null, '2000-01-01', '2100-01-01');
    expect(r.total).toBe(1000);
    expect(r.tickets).toBe(1);
    expect(r.byProduct.map((p) => p.label)).toEqual(['Fernet']);
    expect(r.common).toEqual({ count: 2, total: 4500 });
    // Lo cobrado sí incluye los comunes: es plata que entró a la caja.
    expect(r.byMethod.cash).toBe(5500);
  });
});

describe('stock ilimitado', () => {
  it('no descuenta al vender ni devuelve al anular', async () => {
    const servicio = await product('Carga de garrafa', false);
    const { sale } = await sell(addLine(EMPTY_CART, lineOf(servicio)));
    expect(await db.stock_movements.count()).toBe(0);
    await voidSale(sale.id, 'u1', 'prueba');
    expect(await db.stock_movements.count()).toBe(0);
  });

  it('no lleva ajustes de stock y no suma al valor del inventario', async () => {
    const fernet = await product('Fernet', true, 4);
    const servicio = await product('Servicio', false, 7);
    expect(await db.stock.get(`${store.id}:${servicio.id}`)).toBeUndefined();

    await expect(registerManualMovement({ kind: 'entry', storeId: store.id, product: servicio, quantity: 3, reason: '', userId: null })).rejects.toThrow(InventoryError);
    expect(await stockValuation(store.id)).toEqual({ units: 4, costCents: 2000 });
    expect((await stockValue(store.id)).map((v) => v.products)).toEqual([1]);

    // Si un producto pasa a ilimitado, su stock anterior deja de contar.
    await saveProduct({ ...fernet, barcodes: [], track_stock: false }, fernet.id);
    expect(await stockValuation(store.id)).toEqual({ units: 0, costCents: 0 });
  });
});
