import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { guessMapping, parseCompareRows } from '@/services/spreadsheet';
import { compareInventory } from './inventoryCompare';
import { registerManualMovement } from './inventory';
import { saveProduct, type ProductInput } from './products';

const ORO = 'store-oro';
const base: ProductInput = { name: 'Fernet', brand: null, sku: null, category_id: null, unit: 'unit', cost_cents: 1000, price_cents: 2000, min_stock: 0, auto_min_stock: true, active: true, barcodes: ['111'] };

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('comparar un Excel con el inventario', () => {
  it('muestra diferencias de stock y precio, y lo que no tengo, sin cambiar nada', async () => {
    const fernet = await saveProduct(base);
    const coca = await saveProduct({ ...base, name: 'Coca 2,25', barcodes: ['222'], price_cents: 3000 });
    await saveProduct({ ...base, name: 'Vino Toro', barcodes: [] });
    await registerManualMovement({ kind: 'count', storeId: ORO, product: fernet, quantity: 10, reason: '', userId: null });
    await registerManualMovement({ kind: 'count', storeId: ORO, product: coca, quantity: 4, reason: '', userId: null });

    const matrix = [
      ['Código', 'Descripción', 'Existencia', 'Precio'],
      ['111', 'Fernet 750', 8, 20],
      ['222', 'Coca', 4, 35],
      ['', 'vino toro', 0, 20],
      ['999', 'Quilmes', 12, 15],
      ['', '', '', ''],
      ['333', 'Malo', 'muchos', 10],
    ];
    const rows = parseCompareRows(matrix, guessMapping(matrix));
    const movementsBefore = await db.stock_movements.count();
    const r = await compareInventory(rows, ORO);

    expect(r.map((x) => [x.row.row, x.status, x.quantityDiff, x.priceDiff, x.matchedBy])).toEqual([
      [2, 'diff', -2, false, 'code'], // en el Excel hay 2 menos
      [3, 'diff', 0, true, 'code'], // mismo stock, otro precio
      [4, 'ok', 0, false, 'name'], // sin código: se busca por nombre
      [5, 'missing', null, false, null],
    ]);
    expect(rows.find((x) => x.row === 7)?.errors).toEqual(['Cantidad inválida']);
    expect(await db.stock_movements.count()).toBe(movementsBefore);
  });
});
