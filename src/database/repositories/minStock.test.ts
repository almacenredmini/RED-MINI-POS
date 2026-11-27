import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { addLine, changeQuantity, cartTotals, EMPTY_CART } from '@/services/cart';
import { uuidv7 } from '@/services/id';
import { computePayment } from '@/services/payment';
import { effectiveMinStock, getAutoMinMap, listShortages, minStockWindow, recalcMinStock, recalcMinStockIfNewDay } from './minStock';
import { createSale, voidSale } from './sales';

const STORE = 'store-1';
const OTHER = 'store-2';
// Miércoles 4/11 al mediodía: se mira lo vendido el miércoles anterior, 28/10.
const NOW = new Date(2026, 10, 4, 12);
const line = { product_id: 'p1', name: 'Fernet', barcode: null, unit: 'unit' as const, unit_price_cents: 1000, unit_cost_cents: 600 };

/** Venta de `qty` unidades hace `daysAgo` días (0 = hoy). */
async function sellAt(daysAgo: number, qty: number, storeId = STORE) {
  const cart = changeQuantity(addLine(EMPTY_CART, line), 'p1', qty - 1);
  const { sale } = await createSale({
    id: uuidv7(),
    store: { id: storeId, code: storeId === STORE ? 'ORO' : 'URI' },
    userId: null,
    cart,
    payments: computePayment('card', cartTotals(cart).total, null).payments,
  });
  const when = new Date(2026, 10, 4 - daysAgo, 10);
  await db.sales.update(sale.id, { occurred_at: when.toISOString() });
  return sale;
}

const autoMin = async (storeId = STORE) => (await getAutoMinMap(storeId)).get('p1')?.min_stock;

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('lo que debería tener (stock mínimo automático)', () => {
  it('mira el mismo día de la semana pasada', () => {
    const { from, to } = minStockWindow(NOW);
    expect([from.getDate(), from.getMonth(), from.getDay()]).toEqual([28, 9, 3]);
    expect([to.getDate(), to.getHours()]).toEqual([29, 0]);
  });

  it('el lunes usa lo vendido el lunes anterior, no el resto de la semana', async () => {
    await sellAt(7, 4);
    await sellAt(7, 5);
    await sellAt(1, 30);
    await sellAt(6, 30);
    await sellAt(8, 30);
    await sellAt(14, 30);
    await recalcMinStock(STORE, NOW);
    expect(await autoMin()).toBe(9);
  });

  it('no cuenta las anuladas', async () => {
    const voided = await sellAt(7, 50);
    await voidSale(voided.id, null, 'x');
    await sellAt(7, 8);
    await recalcMinStock(STORE, NOW);
    expect(await autoMin()).toBe(8);
  });

  it('cada sucursal tiene lo suyo', async () => {
    await sellAt(7, 4);
    await sellAt(7, 40, OTHER);
    await recalcMinStock(STORE, NOW);
    await recalcMinStock(OTHER, NOW);
    expect(await autoMin(STORE)).toBe(4);
    expect(await autoMin(OTHER)).toBe(40);
  });

  it('se recalcula una vez por día y cada día mira su día', async () => {
    await sellAt(7, 8);
    await sellAt(6, 2);
    await recalcMinStockIfNewDay(STORE, NOW);
    expect(await autoMin()).toBe(8);
    await sellAt(7, 30);
    await recalcMinStockIfNewDay(STORE, new Date(2026, 10, 4, 20));
    expect(await autoMin()).toBe(8);
    // El jueves mira el jueves anterior.
    await recalcMinStockIfNewDay(STORE, new Date(2026, 10, 5, 8));
    expect(await autoMin()).toBe(2);
  });

  it('respeta el mínimo manual si no hay datos o el cálculo está apagado', async () => {
    await sellAt(7, 8);
    await recalcMinStock(STORE, NOW);
    const auto = await getAutoMinMap(STORE);
    expect(effectiveMinStock({ id: 'p1', min_stock: 3, auto_min_stock: true }, auto)).toBe(8);
    expect(effectiveMinStock({ id: 'p1', min_stock: 3, auto_min_stock: false }, auto)).toBe(3);
    expect(effectiveMinStock({ id: 'sin-ventas', min_stock: 3, auto_min_stock: true }, auto)).toBe(3);
  });

  it('lista lo que falta: lo que debería tener, lo que tiene y la diferencia', async () => {
    const base = { active: true, track_stock: true, deleted_at: null, auto_min_stock: true, min_stock: 0 };
    await db.products.bulkAdd([
      { ...base, id: 'p1', name: 'Fernet' },
      { ...base, id: 'p2', name: 'Coca', auto_min_stock: false, min_stock: 5 },
      { ...base, id: 'p3', name: 'Sobra', auto_min_stock: false, min_stock: 2 },
    ] as never);
    await db.stock.bulkAdd([
      { id: `${STORE}:p2`, store_id: STORE, product_id: 'p2', quantity: 1 },
      { id: `${STORE}:p3`, store_id: STORE, product_id: 'p3', quantity: 2 },
    ] as never);
    await sellAt(7, 8);
    await recalcMinStock(STORE, NOW);
    const list = await listShortages(STORE);
    expect(list.map((s) => [s.product.name, s.should, s.have, s.missing, s.fromSales])).toEqual([
      ['Fernet', 8, -8, 16, true],
      ['Coca', 5, 1, 4, false],
    ]);
  });
});
