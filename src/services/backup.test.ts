import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/database/db';
import { saveProduct } from '@/database/repositories/products';
import { BackupError, backupFilename, buildBackup, parseBackup, restoreBackup } from './backup';

const product = (name: string, stock = 0) =>
  saveProduct({
    name,
    brand: null,
    sku: null,
    category_id: null,
    unit: 'unit',
    cost_cents: 100,
    price_cents: 200,
    min_stock: 0,
    auto_min_stock: false,
    active: true,
    barcodes: [name.toLowerCase()],
    ...(stock ? { stock_adjustment: { store_id: 's1', user_id: null, quantity: stock } } : {}),
  });

/** Pasa la copia por JSON, como si viniera del archivo descargado. */
const roundTrip = async () => parseBackup(JSON.stringify(await buildBackup('test')));

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('copia de seguridad', () => {
  it('incluye las tablas del negocio y deja afuera la cola de sincronización', async () => {
    await db.meta.put({ key: 'x', value: 1 } as never);
    await db.product_images.put({ product_id: 'p1', blob: new Blob(['hola'], { type: 'text/plain' }), updated_at: '2026-11-15T00:00:00Z' });
    const b = await buildBackup('1.0.0');
    expect(b.app).toBe('red-mini-pos');
    expect(Object.keys(b.tables)).toContain('products');
    expect(Object.keys(b.tables)).toContain('staff_schedules');
    expect(Object.keys(b.tables)).not.toContain('sync_queue');
    expect(Object.keys(b.tables)).not.toContain('meta');
    const img = b.tables.product_images![0] as { blob: { __blob: string; type: string } };
    expect(atob(img.blob.__blob)).toBe('hola');
    expect(img.blob.type).toBe('text/plain');
  });

  it('nombra el archivo con fecha y hora', () => {
    expect(backupFilename(new Date(2026, 10, 5, 9, 7))).toBe('redmini-copia-2026-11-05-0907.json');
  });

  it('rechaza archivos que no son copias', () => {
    expect(() => parseBackup('hola')).toThrow(BackupError);
    expect(() => parseBackup('{"app":"otra"}')).toThrow(BackupError);
  });

  it('recupera todo en un dispositivo vacío, con stock y fotos, y lo deja listo para subir', async () => {
    const p = await product('Fernet', 12);
    await db.product_images.put({ product_id: p.id, blob: new Blob(['foto'], { type: 'image/jpeg' }), updated_at: '2026-11-15T00:00:00Z' });
    const copy = await roundTrip();

    await db.delete();
    await db.open();
    const r = await restoreBackup(copy);

    expect(r.restored).toBeGreaterThan(0);
    expect((await db.products.get(p.id))?.name).toBe('Fernet');
    expect((await db.stock.toArray()).map((s) => s.quantity)).toEqual([12]);
    expect(await (await db.product_images.get(p.id))!.blob.text()).toBe('foto');
    const queued = new Set((await db.sync_queue.toArray()).map((q) => q.table));
    expect(queued).toEqual(new Set(['products', 'barcodes', 'stock_movements', 'product_changes', 'product_cost_history']));
    // Lo que se sube no lleva los campos que sólo existen en el dispositivo.
    const payload = (await db.sync_queue.where('table').equals('products').first())!.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty('search_words');
  });

  it('no pisa lo que está más nuevo en el dispositivo ni duplica el stock', async () => {
    const p = await product('Fernet', 5);
    const copy = await roundTrip();
    await saveProduct({ ...(await db.products.get(p.id))!, barcodes: ['fernet'], name: 'Fernet 1L' }, p.id);
    const r = await restoreBackup(copy);

    expect((await db.products.get(p.id))?.name).toBe('Fernet 1L');
    expect((await db.stock.toArray()).map((s) => s.quantity)).toEqual([5]);
    expect(r.restored).toBe(0);
  });
});
