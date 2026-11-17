import { db } from '../db';
import { getDeviceId } from '../meta';
import { enqueue, newMeta, touchMeta } from '../outbox';
import { uuidv7, nowISO } from '@/services/id';
import type { CashPromo, UUID } from '@/types/domain';

export class PromoError extends Error {}

export type PromoInput = Pick<CashPromo, 'active' | 'percent' | 'days' | 'from_time' | 'to_time' | 'round_cents' | 'excluded_category_ids'>;

/** Promos de efectivo de la sucursal (activas y pausadas). */
export async function listPromos(storeId: UUID): Promise<CashPromo[]> {
  return (await db.cash_promos.where('store_id').equals(storeId).toArray()).filter((p) => !p.deleted_at).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function check(input: PromoInput): PromoInput {
  if (!(input.percent > 0 && input.percent < 100)) throw new PromoError('El porcentaje tiene que ser entre 1 y 99');
  if (input.days.length === 0) throw new PromoError('Elegí al menos un día');
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  const from = input.from_time || null;
  const to = input.to_time || null;
  if (!!from !== !!to) throw new PromoError('Completá el horario de inicio y de fin, o dejá los dos vacíos');
  if ((from && !hhmm.test(from)) || (to && !hhmm.test(to))) throw new PromoError('El horario va como 14:00');
  return { ...input, from_time: from, to_time: to, days: [...new Set(input.days)].sort((a, b) => a - b) };
}

async function put(p: CashPromo) {
  await db.cash_promos.put(p);
  await enqueue('cash_promos', p.id, 'upsert', p);
}

/** Crea (sin `id`) o modifica una promo. */
export async function savePromo(storeId: UUID, input: PromoInput, id?: UUID): Promise<void> {
  const clean = check(input);
  const deviceId = await getDeviceId();
  await db.transaction('rw', db.cash_promos, db.sync_queue, async () => {
    const current = id ? await db.cash_promos.get(id) : undefined;
    await put(current ? { ...touchMeta(current, deviceId), ...clean } : { id: uuidv7(), ...newMeta(deviceId), store_id: storeId, ...clean });
  });
}

export async function removePromo(id: UUID): Promise<void> {
  const deviceId = await getDeviceId();
  await db.transaction('rw', db.cash_promos, db.sync_queue, async () => {
    const p = await db.cash_promos.get(id);
    if (p) await put({ ...touchMeta(p, deviceId), deleted_at: nowISO() });
  });
}
