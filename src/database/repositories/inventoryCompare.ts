import { db } from '../db';
import { normalize } from '@/services/search';
import type { CompareRow } from '@/services/spreadsheet';
import type { Product, UUID } from '@/types/domain';

/**
 * Compara un Excel contra el inventario de una sucursal. Sólo mira: no cambia nada.
 * - missing: el producto del Excel no está cargado acá.
 * - diff: está, pero el stock (o el precio, si el Excel lo trae) no coincide.
 * - ok: coincide.
 */
export type CompareStatus = 'missing' | 'diff' | 'ok';

export interface CompareResult {
  row: CompareRow;
  status: CompareStatus;
  product: Product | null;
  /** Stock de la sucursal; null si el producto no existe. */
  myQuantity: number | null;
  /** Excel − mío. null si el Excel no trae cantidad o no tengo el producto. */
  quantityDiff: number | null;
  priceDiff: boolean;
  /** Cómo se encontró: por código o por nombre. */
  matchedBy: 'code' | 'name' | null;
}

export async function compareInventory(rows: CompareRow[], storeId: UUID): Promise<CompareResult[]> {
  const [products, barcodes, stock] = await Promise.all([
    db.products.toArray(),
    db.barcodes.toArray(),
    db.stock.where('store_id').equals(storeId).toArray(),
  ]);
  const live = products.filter((p) => !p.deleted_at);
  const byId = new Map(live.map((p) => [p.id, p]));
  const byCode = new Map(barcodes.filter((b) => !b.deleted_at).map((b) => [b.code, b.product_id]));
  const byName = new Map(live.map((p) => [normalize(p.name), p]));
  const qty = new Map(stock.map((s) => [s.product_id, s.quantity]));

  return rows
    .filter((r) => r.errors.length === 0)
    .map((row) => {
      const viaCode = row.code ? byId.get(byCode.get(row.code) ?? '') : undefined;
      const viaName = !viaCode && row.name ? byName.get(normalize(row.name)) : undefined;
      const product = viaCode ?? viaName ?? null;
      if (!product) return { row, status: 'missing', product: null, myQuantity: null, quantityDiff: null, priceDiff: false, matchedBy: null };
      const myQuantity = qty.get(product.id) ?? 0;
      const quantityDiff = row.quantity === null ? null : Math.round((row.quantity - myQuantity) * 1000) / 1000;
      const priceDiff = row.price_cents !== null && row.price_cents !== product.price_cents;
      const status: CompareStatus = (quantityDiff !== null && quantityDiff !== 0) || priceDiff ? 'diff' : 'ok';
      return { row, status, product, myQuantity, quantityDiff, priceDiff, matchedBy: viaCode ? 'code' : 'name' };
    });
}
