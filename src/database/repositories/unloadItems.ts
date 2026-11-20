import { db } from '../db';
import { getDeviceId } from '../meta';
import { enqueue, newMeta, touchMeta } from '../outbox';
import { nowISO, uuidv7 } from '@/services/id';
import type { UnloadItem, UUID } from '@/types/domain';

/**
 * Mercadería a descargar: lo que se cargó desde Escanear (por ejemplo, en la chata) queda en una lista
 * por sucursal con su casilla, para saber qué bajar al llegar al local. Se ve desde cualquier sucursal.
 */
export async function addUnloadItem(input: { storeId: UUID; productId: UUID; productName: string; quantity: number; movementId?: UUID | null; userId: UUID | null }): Promise<UnloadItem> {
  const deviceId = await getDeviceId();
  const row: UnloadItem = {
    id: uuidv7(),
    ...newMeta(deviceId),
    store_id: input.storeId,
    product_id: input.productId,
    product_name: input.productName,
    quantity: input.quantity,
    movement_id: input.movementId ?? null,
    loaded_by: input.userId,
    checked_at: null,
    checked_by: null,
  };
  await db.transaction('rw', db.unload_items, db.sync_queue, async () => {
    await db.unload_items.put(row);
    await enqueue('unload_items', row.id, 'upsert', row);
  });
  return row;
}

/** Todas las sucursales; lo más nuevo primero. */
export async function listUnloadItems(): Promise<UnloadItem[]> {
  const rows = await db.unload_items.toArray();
  return rows.filter((r) => !r.deleted_at).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

async function change(ids: UUID[], edit: (row: UnloadItem) => Partial<UnloadItem>): Promise<void> {
  const deviceId = await getDeviceId();
  await db.transaction('rw', db.unload_items, db.sync_queue, async () => {
    for (const id of ids) {
      const current = await db.unload_items.get(id);
      if (!current) continue;
      const row = { ...touchMeta(current, deviceId), ...edit(current) };
      await db.unload_items.put(row);
      await enqueue('unload_items', row.id, 'upsert', row);
    }
  });
}

export function setUnloadChecked(id: UUID, checked: boolean, userId: UUID | null): Promise<void> {
  return change([id], () => (checked ? { checked_at: nowISO(), checked_by: userId } : { checked_at: null, checked_by: null }));
}

/** Saca de la lista lo ya descargado de una sucursal. */
export async function clearUnloaded(storeId: UUID): Promise<number> {
  const done = (await listUnloadItems()).filter((r) => r.store_id === storeId && r.checked_at);
  await change(done.map((r) => r.id), () => ({ deleted_at: nowISO() }));
  return done.length;
}
