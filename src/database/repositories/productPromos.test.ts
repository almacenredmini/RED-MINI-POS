import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { addLine, cartTotals, changeQuantity, EMPTY_CART } from '@/services/cart';
import { computeDiscount } from '@/services/cashPromo';
import { computePayment } from '@/services/payment';
import { uuidv7 } from '@/services/id';
import { promoForLine, withProductPromos } from '@/services/productPromo';
import { listProductPromos, ProductPromoError, removeProductPromo, saveProductPromo } from './productPromos';
import { saveProduct, type ProductInput } from './products';
import { createSale } from './sales';

const ORO = { id: 'store-oro', code: 'ORO' };
const base: ProductInput = { name: 'Quilmes 1L', brand: null, sku: null, category_id: null, unit: 'unit', cost_cents: 50000, price_cents: 100000, min_stock: 0, auto_min_stock: true, active: true, barcodes: ['111'] };

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const cartOf = (productId: string, qty: number) =>
  changeQuantity(addLine(EMPTY_CART, { product_id: productId, name: 'Quilmes 1L', barcode: '111', unit: 'unit', unit_price_cents: 100000, unit_cost_cents: 50000 }), productId, qty - 1);

describe('promo por cantidad', () => {
  it('vale sólo dentro del rango de cantidad y de fechas', async () => {
    const p = await saveProduct(base);
    await saveProductPromo(ORO.id, p.id, { unit_price_cents: 90000, min_qty: 3, max_qty: 6, valid_from: '2026-11-17', valid_until: '2026-11-30' });
    const promos = await listProductPromos(ORO.id, undefined, '2026-11-17');
    const priceAt = (qty: number, day = '2026-11-20') => withProductPromos(cartOf(p.id, qty), promos, day).lines[0]!.unit_price_cents;
    expect(priceAt(2)).toBe(100000);
    expect(priceAt(3)).toBe(90000);
    expect(priceAt(6)).toBe(90000);
    expect(priceAt(7)).toBe(100000); // pasado el tope, precio normal
    expect(priceAt(3, '2026-11-30')).toBe(90000); // el último día vale
    expect(priceAt(3, '2026-12-01')).toBe(100000);
    expect(await listProductPromos(ORO.id, undefined, '2026-12-01')).toEqual([]); // vencida ya no se lista
    expect(await listProductPromos('store-uri', undefined, '2026-11-17')).toEqual([]); // es de una sola sucursal
  });

  it('si se pisan dos, gana la más barata; sin tope vale para cualquier cantidad mayor', () => {
    const mk = (id: string, price: number, min: number, max: number | null) =>
      ({ id, store_id: 's', product_id: 'p', unit_price_cents: price, min_qty: min, max_qty: max, valid_from: '2026-01-01', valid_until: '2026-12-31', deleted_at: null }) as never;
    const promos = [mk('a', 90000, 3, null), mk('b', 85000, 6, null)];
    expect(promoForLine({ product_id: 'p', quantity: 4, unit_price_cents: 100000 }, promos, '2026-11-20')).toMatchObject({ id: 'a' });
    expect(promoForLine({ product_id: 'p', quantity: 24, unit_price_cents: 100000 }, promos, '2026-11-20')).toMatchObject({ id: 'b' });
  });

  it('la venta cobra el precio promo y guarda el ahorro como descuento del ítem', async () => {
    const p = await saveProduct(base);
    await saveProductPromo(ORO.id, p.id, { unit_price_cents: 90000, min_qty: 3, max_qty: null, valid_from: '2026-11-17', valid_until: '2099-12-31' });
    const priced = withProductPromos(cartOf(p.id, 3), await listProductPromos(ORO.id, undefined, '2026-11-17'), '2026-11-17');
    expect(cartTotals(priced).total).toBe(270000);
    // No se suma la promo de efectivo sobre algo que ya tiene promo.
    const cashPromo = { id: 'c', store_id: ORO.id, active: true, percent: 10, days: [0, 1, 2, 3, 4, 5, 6], from_time: null, to_time: null, round_cents: 0, created_at: '', updated_at: '', deleted_at: null, version: 1, updated_by_device: 'd' };
    expect(computeDiscount(priced.lines, () => null, [cashPromo], 'cash')).toBeNull();
    const { sale, items } = await createSale({ id: uuidv7(), store: ORO, userId: null, cart: priced, payments: computePayment('cash', 270000, null).payments });
    expect(sale.total_cents).toBe(270000);
    expect(items[0]).toMatchObject({ unit_price_cents: 90000, discount_cents: 30000, total_cents: 270000 });
  });

  it('valida el precio y las cantidades, y se puede borrar', async () => {
    const p = await saveProduct(base);
    const ok = { unit_price_cents: 90000, min_qty: 3, max_qty: null, valid_from: '2026-11-17', valid_until: '2026-11-30' };
    await expect(saveProductPromo(ORO.id, p.id, { ...ok, unit_price_cents: 100000 })).rejects.toThrow(ProductPromoError);
    await expect(saveProductPromo(ORO.id, p.id, { ...ok, max_qty: 2 })).rejects.toThrow(ProductPromoError);
    await saveProductPromo(ORO.id, p.id, ok);
    const [promo] = await listProductPromos(ORO.id, p.id, '2026-11-17');
    await removeProductPromo(promo!.id);
    expect(await listProductPromos(ORO.id, p.id, '2026-11-17')).toEqual([]);
  });
});
