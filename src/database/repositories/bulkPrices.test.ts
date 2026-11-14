import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { applyPriceRule, bulkUpdatePrices } from './bulkPrices';
import { listProductChanges } from './productChanges';
import { deleteProduct, saveProduct, type ProductInput } from './products';

const base: ProductInput = { name: 'Fernet', brand: null, sku: null, category_id: null, unit: 'unit', cost_cents: 600, price_cents: 100000, min_stock: 0, auto_min_stock: true, active: true, barcodes: [] };

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('precios en lote', () => {
  it('calcula por porcentaje o monto, con redondeo, y no deja precios en cero', () => {
    expect(applyPriceRule(100000, { mode: 'percent', value: 10, rounding: 0 })).toBe(110000);
    expect(applyPriceRule(99900, { mode: 'percent', value: 7, rounding: 10000 })).toBe(110000);
    expect(applyPriceRule(100000, { mode: 'amount', value: -25000, rounding: 0 })).toBe(75000);
    expect(applyPriceRule(100000, { mode: 'amount', value: -200000, rounding: 0 })).toBeNull();
  });

  it('cambia los elegidos y deja todo en el reporte de movimientos', async () => {
    const a = await saveProduct({ ...base, user_id: 'u1' });
    const b = await saveProduct({ ...base, name: 'Vino', price_cents: 50000 });
    await saveProduct({ ...base, name: 'Fernet 1L', barcodes: ['779'] }, a.id);
    expect(await bulkUpdatePrices([a.id, b.id], { mode: 'percent', value: 20, rounding: 0 }, 'u1')).toBe(2);
    await deleteProduct(b.id, 'u1');

    expect((await db.products.get(a.id))!.price_cents).toBe(120000);
    const day = [new Date(Date.now() - 86_400_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString()] as const;
    const log = (await listProductChanges(...day)).reverse();
    expect(log.map((c) => [c.product_name, c.action, c.source])).toEqual([
      ['Fernet', 'created', 'manual'],
      ['Vino', 'created', 'manual'],
      ['Fernet 1L', 'updated', 'manual'],
      ['Fernet 1L', 'updated', 'bulk_price'],
      ['Vino', 'updated', 'bulk_price'],
      ['Vino', 'deleted', 'manual'],
    ]);
    expect(log[2]!.changes).toEqual({ name: ['Fernet', 'Fernet 1L'], barcodes: ['', '779'] });
    expect(log[3]!.changes).toEqual({ price_cents: [100000, 120000] });
    expect(log[0]!.user_id).toBe('u1');
  });
});
