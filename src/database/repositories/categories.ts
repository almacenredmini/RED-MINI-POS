import { db } from '../db';
import { getDeviceId } from '../meta';
import { enqueue, newMeta } from '../outbox';
import { uuidv7 } from '@/services/id';
import { normalize } from '@/services/search';
import type { Category } from '@/types/domain';

export async function listCategories(): Promise<Category[]> {
  const all = await db.categories.orderBy('name').toArray();
  return all.filter((c) => c.deleted_at === null);
}

/** Devuelve la categoría existente con ese nombre (sin distinguir acentos/mayúsculas) o la crea. */
export async function ensureCategory(name: string): Promise<Category> {
  const deviceId = await getDeviceId();
  const key = normalize(name);
  return db.transaction('rw', db.categories, db.sync_queue, async () => {
    const existing = await db.categories
      .filter((c) => c.deleted_at === null && normalize(c.name) === key)
      .first();
    if (existing) return existing;

    const category: Category = { id: uuidv7(), name: name.trim(), parent_id: null, ...newMeta(deviceId) };
    await db.categories.add(category);
    await enqueue('categories', category.id, 'upsert', category);
    return category;
  });
}
