import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { deleteProduct, DuplicateBarcodeError, findProductByBarcode, saveProduct, searchProducts, type ProductInput } from './products';

const base: ProductInput = {
  name: 'Fernet Branca 750 ml',
  brand: 'Branca',
  sku: null,
  category_id: null,
  unit: 'unit',
  cost_cents: 800000,
  price_cents: 1200000,
  min_stock: 6,
  auto_min_stock: true,
  active: true,
  barcodes: ['7790290001234'],
};

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('productos', () => {
  it('guarda y encola el cambio en la misma transacción', async () => {
    const p = await saveProduct(base);
    const queue = await db.sync_queue.toArray();
    expect(queue.map((q) => q.table).sort()).toEqual(['barcodes', 'product_cost_history', 'products']);
    expect(queue.find((q) => q.table === 'products')?.record_id).toBe(p.id);
  });

  it('busca por código y por prefijo de palabras sin acentos', async () => {
    await saveProduct(base);
    await saveProduct({ ...base, name: 'Cerveza Quilmes Clásica 1 L', brand: 'Quilmes', barcodes: ['111'] });

    expect((await findProductByBarcode('7790290001234'))?.name).toBe(base.name);
    expect((await searchProducts('quil clasi')).map((p) => p.brand)).toEqual(['Quilmes']);
    expect(await searchProducts('fer 750')).toHaveLength(1);
  });

  it('rechaza un código de barras que ya usa otro producto', async () => {
    await saveProduct(base);
    await expect(saveProduct({ ...base, name: 'Otro' })).rejects.toBeInstanceOf(DuplicateBarcodeError);
    expect(await db.products.count()).toBe(1);
  });

  it('el ajuste de stock suma o resta y queda registrado como movimiento', async () => {
    const adjust = (quantity: number) => ({ store_id: 'store-1', user_id: 'u1', quantity });
    const p = await saveProduct({ ...base, stock_adjustment: adjust(10) });
    await saveProduct({ ...base, stock_adjustment: adjust(-3) }, p.id);
    expect((await db.stock.get(`store-1:${p.id}`))?.quantity).toBe(7);

    const moves = await db.stock_movements.where('product_id').equals(p.id).toArray();
    expect(moves.map((m) => [m.type, m.quantity, m.user_id])).toEqual([
      ['adjustment', 10, 'u1'],
      ['adjustment', -3, 'u1'],
    ]);
    expect((await db.sync_queue.toArray()).filter((q) => q.table === 'stock_movements')).toHaveLength(2);
  });

  it('si el producto no se puede guardar, el ajuste tampoco se aplica', async () => {
    await saveProduct(base);
    await expect(saveProduct({ ...base, name: 'Otro', stock_adjustment: { store_id: 'store-1', user_id: null, quantity: 5 } })).rejects.toBeInstanceOf(DuplicateBarcodeError);
    expect(await db.stock_movements.count()).toBe(0);
    expect(await db.stock.count()).toBe(0);
  });

  it('compacta upserts pendientes del mismo registro y versiona', async () => {
    const p = await saveProduct(base);
    const p2 = await saveProduct({ ...base, price_cents: 1300000 }, p.id);
    expect(p2.version).toBe(2);
    const pending = await db.sync_queue.where('[table+record_id]').equals(['products', p.id]).toArray();
    expect(pending).toHaveLength(1);
  });

  it('el borrado es lógico y libera el código', async () => {
    const p = await saveProduct(base);
    await deleteProduct(p.id);
    expect((await db.products.get(p.id))?.deleted_at).not.toBeNull();
    expect(await findProductByBarcode('7790290001234')).toBeUndefined();
    const again = await saveProduct({ ...base, name: 'Fernet nuevo' });
    expect((await findProductByBarcode('7790290001234'))?.id).toBe(again.id);
  });
});
