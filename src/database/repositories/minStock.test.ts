import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { addLine, changeQuantity, cartTotals, EMPTY_CART } from '@/services/cart';
import { uuidv7 } from '@/services/id';
import { computePayment } from '@/services/payment';
import { effectiveMinStock, getAutoMinMap, recalcMinStock, recalcMinStockIfNewWeek, weekStart } from './minStock';
import { createSale, voidSale } from './sales';

const STORE = 'store-1';
const OTHER = 'store-2';
// Miércoles: la semana en curso arranca el lunes 2 de noviembre.
const NOW = new Date(2026, 10, 4, 12);
const line = { product_id: 'p1', name: 'Fernet', barcode: null, unit: 'unit' as const, unit_price_cents: 1000, unit_cost_cents: 600 };

/** Venta de `qty` unidades hace `weeksAgo` semanas completas (0 = esta semana). */
async function sellAt(weeksAgo: number, qty: number, storeId = STORE) {
  const cart = changeQuantity(addLine(EMPTY_CART, line), 'p1', qty - 1);
  const { sale } = await createSale({
    id: uuidv7(),
    store: { id: storeId, code: storeId === STORE ? 'ORO' : 'URI' },
    userId: null,
    cart,
    payments: computePayment('card', cartTotals(cart).total, null).payments,
  });
  const when = new Date(2026, 10, 3 - weeksAgo * 7, 12);
  await db.sales.update(sale.id, { occurred_at: when.toISOString() });
  return sale;
}

const autoMin = async (storeId = STORE) => (await getAutoMinMap(storeId)).get('p1')?.min_stock;

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('stock mínimo automático', () => {
  it('toma el lunes como inicio de semana', () => {
    expect(weekStart(new Date(2026, 10, 8, 23)).getDate()).toBe(2);
    expect(weekStart(new Date(2026, 10, 2, 0)).getDate()).toBe(2);
  });

  it('promedia las últimas 4 semanas completas y redondea para arriba', async () => {
    await sellAt(1, 10);
    await sellAt(2, 10);
    await sellAt(3, 10);
    await sellAt(4, 11);
    await recalcMinStock(STORE, NOW);
    expect(await autoMin()).toBe(11);
  });

  it('no cuenta la semana en curso, las anuladas ni lo anterior a 4 semanas', async () => {
    await sellAt(0, 100);
    await sellAt(6, 100);
    const voided = await sellAt(1, 50);
    await voidSale(voided.id, null, 'x');
    await sellAt(1, 8);
    await recalcMinStock(STORE, NOW);
    expect(await autoMin()).toBe(2);
  });

  it('con poca historia promedia sólo las semanas que tiene', async () => {
    await sellAt(1, 6);
    await sellAt(2, 6);
    await recalcMinStock(STORE, NOW);
    expect(await autoMin()).toBe(6);
  });

  it('cada sucursal tiene su propio mínimo', async () => {
    await sellAt(1, 4);
    await sellAt(1, 40, OTHER);
    await recalcMinStock(STORE, NOW);
    await recalcMinStock(OTHER, NOW);
    expect(await autoMin(STORE)).toBe(4);
    expect(await autoMin(OTHER)).toBe(40);
  });

  it('se ajusta cuando dejan de venderlo y vuelve al mínimo manual', async () => {
    await sellAt(1, 8);
    await recalcMinStock(STORE, NOW);
    expect(await autoMin()).toBe(8);
    await recalcMinStock(STORE, new Date(2027, 0, 20));
    expect(await autoMin()).toBeUndefined();
  });

  it('recalcula una sola vez por semana', async () => {
    await sellAt(1, 8);
    await recalcMinStockIfNewWeek(STORE, NOW);
    await sellAt(1, 16);
    await recalcMinStockIfNewWeek(STORE, NOW);
    expect(await autoMin()).toBe(8);
    await recalcMinStockIfNewWeek(STORE, new Date(2026, 10, 9, 8));
    expect(await autoMin()).toBe(12);
  });

  it('respeta el mínimo manual si no hay datos o el cálculo está apagado', async () => {
    await sellAt(1, 8);
    await recalcMinStock(STORE, NOW);
    const auto = await getAutoMinMap(STORE);
    expect(effectiveMinStock({ id: 'p1', min_stock: 3, auto_min_stock: true }, auto)).toBe(8);
    expect(effectiveMinStock({ id: 'p1', min_stock: 3, auto_min_stock: false }, auto)).toBe(3);
    expect(effectiveMinStock({ id: 'sin-ventas', min_stock: 3, auto_min_stock: true }, auto)).toBe(3);
  });
});
