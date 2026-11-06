import { db } from '../db';
import { getDeviceId } from '../meta';
import { enqueue, newMeta, touchMeta } from '../outbox';
import { nowISO, uuidv7 } from '@/services/id';
import { buildSearchWords, tokenize } from '@/services/search';
import { recordCost } from './costs';
import { applyStockMovement } from './stock';
import type { Barcode, Product, ProductUnit, UUID } from '@/types/domain';

export interface ProductInput {
  name: string;
  brand: string | null;
  sku: string | null;
  category_id: UUID | null;
  unit: ProductUnit;
  cost_cents: number;
  price_cents: number;
  min_stock: number;
  auto_min_stock: boolean;
  active: boolean;
  barcodes: string[];
  /** Entrada (+) o salida (-) de stock que se guarda junto con el producto. */
  stock_adjustment?: { store_id: UUID; user_id: UUID | null; quantity: number };
  /** undefined = sin cambios; null = quitar imagen; Blob = reemplazar. */
  image?: Blob | null;
}

export class DuplicateBarcodeError extends Error {
  constructor(
    public readonly code: string,
    public readonly productId: string,
  ) {
    super(`El código ${code} ya pertenece a otro producto`);
    this.name = 'DuplicateBarcodeError';
  }
}

const TABLES = [db.products, db.barcodes, db.product_images, db.product_cost_history, db.stock, db.stock_movements, db.sync_queue] as const;

export async function findProductByBarcode(code: string): Promise<Product | undefined> {
  const bc = await db.barcodes.where('code').equals(code.trim()).first();
  if (!bc || bc.deleted_at) return undefined;
  const p = await db.products.get(bc.product_id);
  return p && !p.deleted_at ? p : undefined;
}

/**
 * Búsqueda: código exacto primero; luego por prefijo de cada palabra (AND).
 * Usa el índice multi-entry `search_words` para la primera palabra y filtra el resto en memoria.
 */
export async function searchProducts(query: string, limit = 50): Promise<Product[]> {
  const q = query.trim();
  if (q === '') {
    const all = await db.products.orderBy('name').filter((p) => !p.deleted_at).limit(limit).toArray();
    return all;
  }

  const byCode = await findProductByBarcode(q);
  const tokens = tokenize(q);
  const [first, ...rest] = tokens;
  if (!first) return byCode ? [byCode] : [];

  const candidates = await db.products
    .where('search_words')
    .startsWith(first)
    .distinct()
    .filter((p) => !p.deleted_at && rest.every((t) => p.search_words.some((w) => w.startsWith(t))))
    .limit(limit)
    .toArray();

  candidates.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  if (byCode && !candidates.some((p) => p.id === byCode.id)) candidates.unshift(byCode);
  return candidates;
}

export async function getProductBarcodes(productId: string): Promise<Barcode[]> {
  const rows = await db.barcodes.where('product_id').equals(productId).toArray();
  return rows.filter((b) => !b.deleted_at);
}

export async function saveProduct(input: ProductInput, existingId?: string): Promise<Product> {
  const deviceId = await getDeviceId();
  const codes = [...new Set(input.barcodes.map((c) => c.trim()).filter(Boolean))];

  return db.transaction('rw', TABLES, async () => {
    const id = existingId ?? uuidv7();

    for (const code of codes) {
      const owner = await db.barcodes.where('code').equals(code).first();
      if (owner && !owner.deleted_at && owner.product_id !== id) {
        throw new DuplicateBarcodeError(code, owner.product_id);
      }
    }

    const previous = existingId ? await db.products.get(existingId) : undefined;
    const hasImage = input.image === undefined ? (previous?.has_image ?? false) : input.image !== null;

    const fields = {
      name: input.name.trim(),
      brand: input.brand?.trim() || null,
      sku: input.sku?.trim() || null,
      category_id: input.category_id,
      unit: input.unit,
      cost_cents: input.cost_cents,
      price_cents: input.price_cents,
      min_stock: input.min_stock,
      auto_min_stock: input.auto_min_stock,
      active: input.active,
      has_image: hasImage,
      search_words: buildSearchWords(input.name, input.brand, input.sku),
    };

    const product: Product = previous
      ? { ...touchMeta(previous, deviceId), ...fields }
      : { id, image_path: null, ...newMeta(deviceId), ...fields };

    await db.products.put(product);
    await enqueue('products', id, 'upsert', toSyncProduct(product));

    await syncBarcodes(id, codes, deviceId);

    if (previous ? previous.cost_cents !== input.cost_cents : input.cost_cents > 0) {
      await recordCost(id, input.cost_cents, deviceId);
    }

    if (input.image === null) await db.product_images.delete(id);
    else if (input.image) await db.product_images.put({ product_id: id, blob: input.image, updated_at: nowISO() });

    if (input.stock_adjustment) {
      const { store_id, user_id, quantity } = input.stock_adjustment;
      await applyStockMovement({
        id: uuidv7(),
        store_id,
        product_id: id,
        type: 'adjustment',
        kind: quantity > 0 ? 'entry' : 'exit',
        quantity,
        unit_cost_cents: input.cost_cents,
        reason: 'Ajuste desde la ficha del producto',
        reference_type: null,
        reference_id: null,
        user_id,
        device_id: deviceId,
        occurred_at: nowISO(),
      });
    }

    return product;
  });
}

async function syncBarcodes(productId: string, codes: string[], deviceId: string) {
  const current = await db.barcodes.where('product_id').equals(productId).toArray();

  for (const bc of current) {
    if (!bc.deleted_at && !codes.includes(bc.code)) {
      const removed = { ...touchMeta(bc, deviceId), deleted_at: nowISO() };
      await db.barcodes.put(removed);
      await enqueue('barcodes', bc.id, 'upsert', removed);
    }
  }

  for (const code of codes) {
    const existing = await db.barcodes.where('code').equals(code).first();
    if (existing && !existing.deleted_at) continue;

    // Un código borrado lógicamente se reactiva (el índice único impide duplicarlo).
    const bc: Barcode = existing
      ? { ...touchMeta(existing, deviceId), product_id: productId, deleted_at: null }
      : { id: uuidv7(), code, product_id: productId, pack_qty: 1, ...newMeta(deviceId) };
    await db.barcodes.put(bc);
    await enqueue('barcodes', bc.id, 'upsert', bc);
  }
}

export async function deleteProduct(id: string): Promise<void> {
  const deviceId = await getDeviceId();
  await db.transaction('rw', TABLES, async () => {
    const p = await db.products.get(id);
    if (!p) return;
    const removed = { ...touchMeta(p, deviceId), deleted_at: nowISO(), active: false };
    await db.products.put(removed);
    await enqueue('products', id, 'upsert', toSyncProduct(removed));
    await syncBarcodes(id, [], deviceId);
  });
}

export function toSyncProduct(p: Product) {
  const { search_words: _sw, has_image: _hi, ...rest } = p;
  return rest;
}
