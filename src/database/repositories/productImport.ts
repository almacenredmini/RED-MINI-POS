import { db } from '../db';
import { getDeviceId } from '../meta';
import { enqueueMany, newMeta, touchMeta } from '../outbox';
import { nowISO, uuidv7 } from '@/services/id';
import { buildSearchWords, normalize } from '@/services/search';
import type { ImportRow } from '@/services/spreadsheet';
import type { Barcode, Category, Product, ProductCost, StockMovement, UUID } from '@/types/domain';
import { newCostRow } from './costs';
import { toSyncProduct } from './products';
import { applyStockMovements } from './stock';

const TABLES = [db.categories, db.products, db.barcodes, db.product_cost_history, db.stock, db.stock_movements, db.sync_queue];

export type ImportAction = 'create' | 'update';

/** Índices del catálogo para decidir, fila por fila, si el producto ya existe. */
async function loadCatalog() {
  const [products, barcodes] = await Promise.all([db.products.toArray(), db.barcodes.toArray()]);
  const byId = new Map(products.filter((p) => !p.deleted_at).map((p) => [p.id, p]));
  const barcodeRows = new Map(barcodes.map((b) => [b.code, b]));
  const withCode = new Set(barcodes.filter((b) => !b.deleted_at).map((b) => b.product_id));
  const byName = new Map([...byId.values()].filter((p) => !withCode.has(p.id)).map((p) => [normalize(p.name), p]));
  return { byId, barcodeRows, byName };
}

type Catalog = Awaited<ReturnType<typeof loadCatalog>>;

/**
 * Primero por código. Por nombre sólo si el producto existente no tiene código:
 * en Eleventa dos productos pueden llamarse igual con códigos distintos, y no hay que mezclarlos.
 */
function resolve(row: ImportRow, { byId, barcodeRows, byName }: Catalog): Product | undefined {
  if (row.code) {
    const barcode = barcodeRows.get(row.code);
    const owner = barcode && !barcode.deleted_at ? byId.get(barcode.product_id) : undefined;
    if (owner) return owner;
  }
  return byName.get(normalize(row.name));
}

export async function previewImport(rows: ImportRow[]): Promise<Map<number, ImportAction>> {
  const catalog = await loadCatalog();
  return new Map(rows.filter((r) => r.errors.length === 0).map((r) => [r.row, resolve(r, catalog) ? 'update' : 'create']));
}

/**
 * Todo el archivo entra en una sola transacción: si algo falla, no queda nada a medias.
 * La cantidad es el stock real que informa Eleventa: se registra la diferencia como movimiento,
 * así que importar dos veces el mismo archivo no duplica el stock.
 */
export async function importProducts(rows: ImportRow[], storeId: UUID, userId: UUID | null) {
  const deviceId = await getDeviceId();
  const valid = rows.filter((r) => r.errors.length === 0);
  const result = { created: 0, updated: 0, movements: 0, skipped: rows.length - valid.length };

  await db.transaction('rw', TABLES, async () => {
    const catalog = await loadCatalog();
    const stock = new Map((await db.stock.where('store_id').equals(storeId).toArray()).map((s) => [s.product_id, s.quantity]));
    const now = nowISO();
    const categoryIds = new Map((await db.categories.toArray()).filter((c) => !c.deleted_at).map((c) => [normalize(c.name), c.id]));
    const newCategories: Category[] = [];

    /** Reutiliza la categoría si ya existe, sin distinguir mayúsculas ni acentos. */
    const categoryId = (name: string): UUID => {
      const key = normalize(name);
      const found = categoryIds.get(key);
      if (found) return found;
      const category: Category = { id: uuidv7(), name, parent_id: null, ...newMeta(deviceId) };
      categoryIds.set(key, category.id);
      newCategories.push(category);
      return category.id;
    };

    // Se arma todo en memoria y se escribe en bloque: con miles de filas, escribir de a una tarda minutos.
    const products = new Map<UUID, Product>();
    const barcodes: Barcode[] = [];
    const costs: ProductCost[] = [];
    const movements: StockMovement[] = [];

    for (const row of valid) {
      const existing = resolve(row, catalog);
      const product: Product = existing
        ? {
            ...touchMeta(existing, deviceId),
            name: row.name,
            category_id: row.category ? categoryId(row.category) : existing.category_id,
            cost_cents: row.cost_cents ?? existing.cost_cents,
            price_cents: row.price_cents,
            search_words: buildSearchWords(row.name, existing.brand, existing.sku),
          }
        : {
            id: uuidv7(),
            sku: null,
            name: row.name,
            brand: null,
            category_id: row.category ? categoryId(row.category) : null,
            unit: 'unit',
            cost_cents: row.cost_cents ?? 0,
            price_cents: row.price_cents,
            min_stock: 0,
            auto_min_stock: true,
            image_path: null,
            has_image: false,
            active: true,
            search_words: buildSearchWords(row.name),
            ...newMeta(deviceId),
          };

      products.set(product.id, product);
      catalog.byId.set(product.id, product);
      if (existing) result.updated += 1;
      else result.created += 1;

      if (existing ? existing.cost_cents !== product.cost_cents : product.cost_cents > 0) {
        costs.push(newCostRow(product.id, product.cost_cents, deviceId));
      }

      if (row.code) {
        const barcode = catalog.barcodeRows.get(row.code);
        if (!barcode || barcode.deleted_at || barcode.product_id !== product.id) {
          const next: Barcode = barcode
            ? { ...touchMeta(barcode, deviceId), product_id: product.id, deleted_at: null }
            : { id: uuidv7(), code: row.code, product_id: product.id, pack_qty: 1, ...newMeta(deviceId) };
          barcodes.push(next);
          catalog.barcodeRows.set(row.code, next);
        }
        catalog.byName.delete(normalize(row.name));
      } else if (!existing) {
        catalog.byName.set(normalize(row.name), product);
      }

      if (row.quantity !== null) {
        const current = stock.get(product.id) ?? 0;
        const delta = row.quantity - current;
        if (delta !== 0) {
          const initial = current === 0 && delta > 0;
          movements.push({
            id: uuidv7(),
            store_id: storeId,
            product_id: product.id,
            type: initial ? 'initial' : 'adjustment',
            ...(initial ? {} : { kind: 'count' as const }),
            quantity: delta,
            unit_cost_cents: product.cost_cents,
            reason: 'Importación desde Excel',
            reference_type: null,
            reference_id: null,
            user_id: userId,
            device_id: deviceId,
            occurred_at: now,
          });
          stock.set(product.id, row.quantity);
          result.movements += 1;
        }
      }
    }

    await db.categories.bulkAdd(newCategories);
    await db.products.bulkPut([...products.values()]);
    await db.barcodes.bulkPut(barcodes);
    await db.product_cost_history.bulkAdd(costs);
    await enqueueMany([
      ...newCategories.map((c) => ({ table: 'categories' as const, record_id: c.id, op: 'upsert' as const, payload: c })),
      ...[...products.values()].map((p) => ({ table: 'products' as const, record_id: p.id, op: 'upsert' as const, payload: toSyncProduct(p) })),
      ...barcodes.map((b) => ({ table: 'barcodes' as const, record_id: b.id, op: 'upsert' as const, payload: b })),
      ...costs.map((c) => ({ table: 'product_cost_history' as const, record_id: c.id, op: 'upsert' as const, payload: c })),
    ]);
    await applyStockMovements(movements);
  });

  return result;
}
