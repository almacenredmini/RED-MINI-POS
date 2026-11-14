import { db } from '../db';
import { enqueue } from '../outbox';
import { nowISO, uuidv7 } from '@/services/id';
import type { Product, ProductChange, ProductChangeAction, ProductChangeSource, UUID } from '@/types/domain';

/** Campos que se registran en el Reporte de movimientos (no los automáticos, como el mínimo semanal). */
const TRACKED = ['name', 'brand', 'category_id', 'unit', 'cost_cents', 'price_cents', 'active'] as const;
type Tracked = (typeof TRACKED)[number];

export function diffProduct(before: Product | undefined, after: Product): ProductChange['changes'] {
  const changes: ProductChange['changes'] = {};
  if (!before) return changes;
  for (const key of TRACKED) {
    if (before[key] !== after[key]) changes[key] = [before[key], after[key]];
  }
  return changes;
}

export interface ChangeContext {
  source: ProductChangeSource;
  userId: UUID | null;
  deviceId: UUID;
  occurredAt?: string;
}

/**
 * Arma el registro de un cambio. Devuelve null si una modificación no tocó nada de lo que se registra.
 * Para bajas, `after` es el producto ya borrado.
 */
export function buildProductChange(
  before: Product | undefined,
  after: Product,
  ctx: ChangeContext,
  extra: ProductChange['changes'] = {},
): ProductChange | null {
  const action: ProductChangeAction = !before ? 'created' : after.deleted_at && !before.deleted_at ? 'deleted' : 'updated';
  const changes = action === 'updated' ? { ...diffProduct(before, after), ...extra } : {};
  if (action === 'updated' && Object.keys(changes).length === 0) return null;
  return {
    id: uuidv7(),
    product_id: after.id,
    product_name: after.name,
    action,
    changes,
    source: ctx.source,
    user_id: ctx.userId,
    device_id: ctx.deviceId,
    occurred_at: ctx.occurredAt ?? nowISO(),
  };
}

/** Guarda el cambio. Llamar dentro de una transacción que incluya `product_changes` y `sync_queue`. */
export async function logProductChange(before: Product | undefined, after: Product, ctx: ChangeContext, extra?: ProductChange['changes']) {
  const change = buildProductChange(before, after, ctx, extra);
  if (!change) return;
  await db.product_changes.add(change);
  await enqueue('product_changes', change.id, 'upsert', change);
}

/** Cambios de un día (desde / hasta en ISO), del más nuevo al más viejo. */
export async function listProductChanges(from: string, to: string): Promise<ProductChange[]> {
  const rows = await db.product_changes.where('occurred_at').between(from, to, true, false).toArray();
  return rows.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) || b.id.localeCompare(a.id));
}

export type { Tracked };
