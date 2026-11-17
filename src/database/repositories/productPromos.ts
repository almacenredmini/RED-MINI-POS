import { db } from '../db';
import { getDeviceId } from '../meta';
import { enqueue, newMeta, touchMeta } from '../outbox';
import { nowISO, uuidv7 } from '@/services/id';
import type { ProductPromo, UUID } from '@/types/domain';
import { dayKey } from './tasks';

export class ProductPromoError extends Error {}

export type ProductPromoInput = Pick<ProductPromo, 'unit_price_cents' | 'min_qty' | 'max_qty' | 'valid_from' | 'valid_until'>;

/** Promos de la sucursal que todavía no vencieron (de un producto, si se indica). */
export async function listProductPromos(storeId: UUID, productId?: UUID, today: string = dayKey()): Promise<ProductPromo[]> {
  const rows = productId ? await db.product_promos.where('product_id').equals(productId).toArray() : await db.product_promos.where('store_id').equals(storeId).toArray();
  return rows
    .filter((p) => p.store_id === storeId && !p.deleted_at && p.valid_until >= today)
    .sort((a, b) => a.min_qty - b.min_qty || a.created_at.localeCompare(b.created_at));
}

function check(input: ProductPromoInput, listPrice: number): ProductPromoInput {
  if (!(input.unit_price_cents > 0)) throw new ProductPromoError('Ingresá el precio promo');
  if (input.unit_price_cents >= listPrice) throw new ProductPromoError('El precio promo tiene que ser menor al precio normal');
  if (!(input.min_qty > 0)) throw new ProductPromoError('La cantidad desde tiene que ser mayor a cero');
  if (input.max_qty !== null && input.max_qty < input.min_qty) throw new ProductPromoError('La cantidad hasta no puede ser menor a la cantidad desde');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.valid_until)) throw new ProductPromoError('Elegí hasta cuándo vale');
  if (input.valid_until < input.valid_from) throw new ProductPromoError('La fecha de fin ya pasó');
  return input;
}

export async function saveProductPromo(storeId: UUID, productId: UUID, input: ProductPromoInput, id?: UUID): Promise<void> {
  const product = await db.products.get(productId);
  if (!product) throw new ProductPromoError('El producto no existe');
  const clean = check(input, product.price_cents);
  const deviceId = await getDeviceId();
  await db.transaction('rw', db.product_promos, db.sync_queue, async () => {
    const current = id ? await db.product_promos.get(id) : undefined;
    const row: ProductPromo = current
      ? { ...touchMeta(current, deviceId), ...clean }
      : { id: uuidv7(), ...newMeta(deviceId), store_id: storeId, product_id: productId, ...clean };
    await db.product_promos.put(row);
    await enqueue('product_promos', row.id, 'upsert', row);
  });
}

export async function removeProductPromo(id: UUID): Promise<void> {
  const deviceId = await getDeviceId();
  await db.transaction('rw', db.product_promos, db.sync_queue, async () => {
    const p = await db.product_promos.get(id);
    if (!p) return;
    const row = { ...touchMeta(p, deviceId), deleted_at: nowISO() };
    await db.product_promos.put(row);
    await enqueue('product_promos', row.id, 'upsert', row);
  });
}
