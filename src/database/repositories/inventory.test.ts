import { beforeEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { db } from '../db';
import { assignColumn, columnLetter, guessMapping, parseImportRows, readSpreadsheet, SpreadsheetError } from '@/services/spreadsheet';
import { ensureCategory, listCategories } from './categories';
import { listProductCosts } from './costs';
import { InventoryError, listMovements, movementLabel, registerManualMovement, stockValuation, transferStock } from './inventory';
import { importProducts, previewImport } from './productImport';
import { findProductByBarcode, saveProduct, type ProductInput } from './products';
import { cancelPurchase, getPurchaseDetail, PurchaseError, savePurchase, type PurchaseInput } from './purchases';
import { saveSupplier, SupplierError } from './suppliers';

const ORO = 'store-oro';
const URI = 'store-uri';

const base: ProductInput = {
  name: 'Fernet',
  brand: null,
  sku: null,
  category_id: null,
  unit: 'unit',
  cost_cents: 1000,
  price_cents: 2000,
  min_stock: 0,
  auto_min_stock: true,
  active: true,
  barcodes: ['111'],
};

const stockOf = async (storeId: string, productId: string) => (await db.stock.get(`${storeId}:${productId}`))?.quantity ?? 0;

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('movimientos manuales', () => {
  it('entrada, salida y conteo dejan el stock correcto y registran el movimiento', async () => {
    const p = await saveProduct(base);
    const common = { storeId: ORO, product: p, reason: '', userId: 'u1' };
    await registerManualMovement({ ...common, kind: 'entry', quantity: 10 });
    await registerManualMovement({ ...common, kind: 'exit', quantity: 3, reason: 'Rotura' });
    await registerManualMovement({ ...common, kind: 'count', quantity: 5 });
    expect(await stockOf(ORO, p.id)).toBe(5);

    const moves = await listMovements(ORO, p.id);
    expect(moves.map((m) => [movementLabel(m), m.quantity]).sort()).toEqual([
      ['Conteo', -2],
      ['Entrada', 10],
      ['Salida', -3],
    ]);
  });

  it('valida cantidad, motivo de salida y conteo sin diferencia', async () => {
    const p = await saveProduct(base);
    const common = { storeId: ORO, product: p, reason: '', userId: null };
    await expect(registerManualMovement({ ...common, kind: 'entry', quantity: 0 })).rejects.toBeInstanceOf(InventoryError);
    await expect(registerManualMovement({ ...common, kind: 'exit', quantity: 1 })).rejects.toThrow('motivo');
    await expect(registerManualMovement({ ...common, kind: 'count', quantity: 0 })).rejects.toThrow('coincide');
    expect(await db.stock_movements.count()).toBe(0);
  });

  it('transfiere entre sucursales con dos movimientos vinculados', async () => {
    const p = await saveProduct(base);
    await registerManualMovement({ storeId: ORO, product: p, reason: '', userId: null, kind: 'entry', quantity: 10 });
    await transferStock({ fromStoreId: ORO, toStoreId: URI, product: p, quantity: 4, reason: '', userId: 'u1' });
    expect(await stockOf(ORO, p.id)).toBe(6);
    expect(await stockOf(URI, p.id)).toBe(4);

    const [out] = await listMovements(ORO, p.id, 1);
    const [incoming] = await listMovements(URI, p.id, 1);
    expect(out?.type).toBe('transfer_out');
    expect(incoming?.type).toBe('transfer_in');
    expect(out?.transfer_id).toBe(incoming?.transfer_id);
    await expect(transferStock({ fromStoreId: ORO, toStoreId: ORO, product: p, quantity: 1, reason: '', userId: null })).rejects.toThrow('destino');
  });

  it('valoriza sólo el stock positivo de la sucursal', async () => {
    const p = await saveProduct(base);
    const q = await saveProduct({ ...base, name: 'Vino', barcodes: ['222'] });
    await registerManualMovement({ storeId: ORO, product: p, reason: '', userId: null, kind: 'entry', quantity: 3 });
    await registerManualMovement({ storeId: ORO, product: q, reason: 'x', userId: null, kind: 'exit', quantity: 2 });
    expect(await stockValuation(ORO)).toEqual({ units: 3, costCents: 3000 });
  });
});

describe('compras', () => {
  const input = (productId: string, supplierId: string | null): PurchaseInput => ({
    store_id: ORO,
    supplier_id: supplierId,
    invoice_type: 'A',
    invoice_number: '0001-123',
    invoice_date: '2026-11-04',
    notes: null,
    lines: [{ product_id: productId, quantity: 6, unit_cost_cents: 1500 }],
  });
  const supplier = () => saveSupplier({ name: 'Distribuidora', tax_id: '30-1', phone: null, email: null, notes: null, active: true });

  it('un borrador no toca stock ni costos', async () => {
    const p = await saveProduct(base);
    await savePurchase(input(p.id, null), { receive: false, userId: null });
    expect(await stockOf(ORO, p.id)).toBe(0);
    expect((await db.products.get(p.id))?.cost_cents).toBe(1000);
  });

  it('recibir suma stock, actualiza costo e historial sin tocar el precio de venta', async () => {
    const p = await saveProduct(base);
    const s = await supplier();
    const draft = await savePurchase(input(p.id, s.id), { receive: false, userId: null });
    const received = await savePurchase(input(p.id, s.id), { id: draft.id, receive: true, userId: 'u1' });

    expect(received.status).toBe('received');
    expect(received.total_cents).toBe(9000);
    expect(await stockOf(ORO, p.id)).toBe(6);
    const updated = await db.products.get(p.id);
    expect(updated?.cost_cents).toBe(1500);
    expect(updated?.price_cents).toBe(2000);

    const costs = await listProductCosts(p.id);
    expect(costs[0]).toMatchObject({ cost_cents: 1500, supplier_id: s.id, purchase_id: draft.id });
    expect((await getPurchaseDetail(draft.id))?.items).toHaveLength(1);
  });

  it('una compra recibida no se puede cambiar ni cancelar, y no duplica stock', async () => {
    const p = await saveProduct(base);
    const s = await supplier();
    const received = await savePurchase(input(p.id, s.id), { receive: true, userId: null });
    await expect(savePurchase(input(p.id, s.id), { id: received.id, receive: true, userId: null })).rejects.toBeInstanceOf(PurchaseError);
    await expect(cancelPurchase(received.id)).rejects.toThrow('borrador');
    expect(await stockOf(ORO, p.id)).toBe(6);
  });

  it('rechaza factura repetida, compra vacía y recepción sin proveedor', async () => {
    const p = await saveProduct(base);
    const s = await supplier();
    await savePurchase(input(p.id, s.id), { receive: true, userId: null });
    await expect(savePurchase(input(p.id, s.id), { receive: true, userId: null })).rejects.toThrow('ya está cargada');
    await expect(savePurchase({ ...input(p.id, s.id), invoice_number: null, lines: [] }, { receive: false, userId: null })).rejects.toThrow('producto');
    await expect(savePurchase({ ...input(p.id, null), invoice_number: '9' }, { receive: true, userId: null })).rejects.toThrow('proveedor');
    expect(await stockOf(ORO, p.id)).toBe(6);
  });

  it('un error al recibir no deja nada a medias', async () => {
    const p = await saveProduct(base);
    await expect(savePurchase({ ...input(p.id, 's'), lines: [{ product_id: p.id, quantity: 0, unit_cost_cents: 1 }] }, { receive: true, userId: null })).rejects.toThrow('cantidades');
    expect(await db.purchases.count()).toBe(0);
  });

  it('no permite dos proveedores con el mismo CUIT', async () => {
    await supplier();
    await expect(supplier()).rejects.toBeInstanceOf(SupplierError);
  });
});

describe('importación de Excel', () => {
  const HEAD = ['Nombre', 'Codigo de barra', 'Cantidad', 'Precio costo', 'Precio de venta'];

  it('reconoce títulos en cualquier orden, con acentos y filas previas', () => {
    const rows = parseImportRows([
      ['Reporte de inventario'],
      [],
      ['PRECIO DE VENTA', 'Código de Barras', 'nombre', 'Precio de Costo', 'Existencia'],
      [2500.5, 779, 'Fernet', 1000, 4],
    ]);
    expect(rows[0]).toMatchObject({ row: 4, name: 'Fernet', code: '779', quantity: 4, cost_cents: 100000, price_cents: 250050, errors: [] });
  });

  it('acepta precios en formato argentino y cantidades vacías o negativas', () => {
    const rows = parseImportRows([HEAD, ['A', '1', '', '$ 1.234,50', '2.000,00'], ['B', '2', -3, null, 500]]);
    expect(rows[0]).toMatchObject({ quantity: null, cost_cents: 123450, price_cents: 200000, errors: [] });
    expect(rows[1]).toMatchObject({ quantity: -3, cost_cents: null, errors: [] });
  });

  it('informa los errores por fila', () => {
    const rows = parseImportRows([HEAD, ['', '1', 1, 1, 1], ['B', '2', 1, 1, 0], ['C', '2', 1, 1, 1], ['D', '3', 'x', 'y', 1], ['E', '', 1, 1, 1], ['e', '', 1, 1, 1], [null, null, null, null, null]]);
    expect(rows.map((r) => r.errors.length)).toEqual([1, 1, 1, 2, 0, 1]);
    expect(rows[2]?.errors[0]).toContain('repetido');
  });

  it('usa las columnas que elige el usuario, aunque no haya títulos', () => {
    const matrix = [[779, 'Fernet', 4, 1000, 2000], [780, 'Vino', 1, 500, 900]];
    const rows = parseImportRows(matrix, { headerIndex: -1, columns: { code: 0, name: 1, quantity: 2, cost: 3, price: 4 } });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ row: 1, name: 'Fernet', code: '779', quantity: 4, cost_cents: 100000, price_cents: 200000, errors: [] });
  });

  it('el usuario puede corregir lo que se adivinó por los títulos', () => {
    const matrix = [['Codigo', 'Otro', 'Precio'], [1, 'Fernet', 100]];
    const guessed = guessMapping(matrix);
    expect(guessed).toEqual({ headerIndex: 0, columns: { code: 0, price: 2 } });
    const columns = assignColumn(guessed.columns, 1, 'name');
    expect(parseImportRows(matrix, { ...guessed, columns })[0]).toMatchObject({ name: 'Fernet', code: '1', price_cents: 10000 });
  });

  it('una columna tiene un solo significado y un dato sale de una sola columna', () => {
    expect(assignColumn({ name: 0, price: 1 }, 0, 'code')).toEqual({ code: 0, price: 1 });
    expect(assignColumn({ name: 0 }, 2, 'name')).toEqual({ name: 2 });
    expect(assignColumn({ name: 0 }, 0, null)).toEqual({});
  });

  it('nombra las columnas como Excel', () => {
    expect([0, 25, 26, 27, 701].map(columnLetter)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ']);
  });

  it('reconoce la categoría por título o por elección del usuario', () => {
    const rows = parseImportRows([['Nombre', 'Departamento', 'Precio de venta'], ['Fernet', ' Aperitivos ', 100], ['Vino', '', 100]]);
    expect(rows.map((r) => r.category)).toEqual(['Aperitivos', null]);
    const mapped = parseImportRows([['Fernet', 'Licores', 100]], { headerIndex: -1, columns: { name: 0, category: 1, price: 2 } });
    expect(mapped[0]?.category).toBe('Licores');
  });

  it('crea las categorías nuevas una sola vez y reutiliza las existentes', async () => {
    const existing = await ensureCategory('Aperitivos');
    await importProducts(
      [
        row({ row: 2, name: 'A', code: '1', category: 'APERITIVOS' }),
        row({ row: 3, name: 'B', code: '2', category: 'Vinos' }),
        row({ row: 4, name: 'C', code: '3', category: 'vinos' }),
        row({ row: 5, name: 'D', code: '4', category: null }),
      ],
      ORO,
      null,
    );
    expect((await listCategories()).map((c) => c.name)).toEqual(['Aperitivos', 'Vinos']);
    const byCode = async (code: string) => (await findProductByBarcode(code))?.category_id;
    expect(await byCode('1')).toBe(existing.id);
    expect(await byCode('2')).toBe(await byCode('3'));
    expect(await byCode('4')).toBeNull();
    expect((await db.sync_queue.toArray()).filter((q) => q.table === 'categories')).toHaveLength(2);
  });

  it('actualizar cambia la categoría, y una celda vacía conserva la que tenía', async () => {
    const cat = await ensureCategory('Aperitivos');
    const p = await saveProduct({ ...base, category_id: cat.id });
    await importProducts([row({ category: null })], ORO, null);
    expect((await db.products.get(p.id))?.category_id).toBe(cat.id);
    await importProducts([row({ category: 'Licores' })], ORO, null);
    expect((await db.products.get(p.id))?.category_id).not.toBe(cat.id);
  });

  it('una fila sin costo conserva el costo del producto existente', async () => {
    const p = await saveProduct(base);
    await importProducts([{ row: 2, name: 'Fernet', code: '111', quantity: null, cost_cents: null, price_cents: 3000, category: null, errors: [] }], ORO, null);
    expect(await db.products.get(p.id)).toMatchObject({ cost_cents: 1000, price_cents: 3000 });
    expect(await listProductCosts(p.id)).toHaveLength(1);
  });

  it('rechaza un archivo sin los títulos', () => {
    expect(() => parseImportRows([['a', 'b'], [1, 2]])).toThrow(SpreadsheetError);
  });

  it.each([
    ['xlsx', 'xlsx'],
    ['xls', 'biff8'],
  ] as const)('lee un archivo .%s real', async (_ext, bookType) => {
    const sheet = XLSX.utils.aoa_to_sheet([HEAD, ['Fernet', 7790001234568, 4, 1000.5, 2000]]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Hoja1');
    const data: ArrayBuffer = XLSX.write(book, { type: 'array', bookType });
    const rows = await readSpreadsheet(new Blob([data]));
    expect(rows[0]).toMatchObject({ name: 'Fernet', code: '7790001234568', quantity: 4, cost_cents: 100050, price_cents: 200000, errors: [] });
  });

  it('lee un .csv con punto y coma, formato argentino y ceros adelante', async () => {
    const csv = 'Nombre;Codigo de barra;Cantidad;Precio costo;Precio de venta\nFernet;00779;1.000;1.000,50;2.000,00\nVino;;1,5;10.5;20';
    const rows = await readSpreadsheet(new Blob([csv]));
    expect(rows[0]).toMatchObject({ name: 'Fernet', code: '00779', quantity: 1000, cost_cents: 100050, price_cents: 200000, errors: [] });
    expect(rows[1]).toMatchObject({ name: 'Vino', code: null, quantity: 1.5, cost_cents: 1050, price_cents: 2000, errors: [] });
  });

  const row = (over: Partial<Parameters<typeof importProducts>[0][number]>) => ({ row: 2, name: 'Fernet', code: '111', quantity: 5, cost_cents: 1000, price_cents: 2000, category: null, errors: [], ...over });

  it('crea productos, código y stock inicial en la sucursal', async () => {
    const rows = [row({}), row({ row: 3, name: 'Vino', code: null, quantity: null }), row({ row: 4, name: 'Malo', code: '999', errors: ['x'] })];
    expect([...(await previewImport(rows)).values()]).toEqual(['create', 'create']);
    expect(await importProducts(rows, ORO, 'u1')).toEqual({ created: 2, updated: 0, movements: 1, skipped: 1 });

    const p = await findProductByBarcode('111');
    expect(await stockOf(ORO, p!.id)).toBe(5);
    expect((await listMovements(ORO, p!.id))[0]?.type).toBe('initial');
    expect(await db.products.count()).toBe(2);
  });

  it('actualizar deja el stock en la cantidad del archivo y no lo duplica', async () => {
    const p = await saveProduct(base);
    await registerManualMovement({ storeId: ORO, product: p, reason: '', userId: null, kind: 'entry', quantity: 2 });
    const rows = [row({ name: 'Fernet 750', quantity: 9, cost_cents: 1200, price_cents: 2500 })];
    expect([...(await previewImport(rows)).values()]).toEqual(['update']);
    await importProducts(rows, ORO, null);
    await importProducts(rows, ORO, null);

    expect(await stockOf(ORO, p.id)).toBe(9);
    expect(await db.products.count()).toBe(1);
    expect((await db.products.get(p.id))).toMatchObject({ name: 'Fernet 750', cost_cents: 1200, price_cents: 2500 });
    expect(await db.stock_movements.count()).toBe(2);
    expect((await listProductCosts(p.id))[0]?.cost_cents).toBe(1200);
  });

  it('no mezcla productos con el mismo nombre y distinto código, y completa el código al que no tenía', async () => {
    const withCode = await saveProduct(base);
    const noCode = await saveProduct({ ...base, name: 'Vino', barcodes: [] });
    await importProducts([row({ code: '222' }), row({ row: 3, name: 'vino', code: '333' })], ORO, null);

    expect((await findProductByBarcode('111'))?.id).toBe(withCode.id);
    expect((await findProductByBarcode('222'))?.id).not.toBe(withCode.id);
    expect((await findProductByBarcode('333'))?.id).toBe(noCode.id);
  });

  it('el stock de otra sucursal no se toca', async () => {
    const p = await saveProduct(base);
    await registerManualMovement({ storeId: URI, product: p, reason: '', userId: null, kind: 'entry', quantity: 7 });
    await importProducts([row({ quantity: 1 })], ORO, null);
    expect(await stockOf(URI, p.id)).toBe(7);
    expect(await stockOf(ORO, p.id)).toBe(1);
  });
});
