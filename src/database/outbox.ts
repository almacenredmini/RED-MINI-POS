import { db } from './db';
import { nowISO, uuidv7 } from '@/services/id';
import type { SyncMeta, SyncOperation, SyncQueueEntry, SyncTable } from '@/types/domain';

/**
 * Patrón Outbox: cada escritura de negocio encola su cambio en `sync_queue`
 * dentro de la MISMA transacción Dexie. Si la transacción falla, no queda ni el dato ni el evento;
 * si se confirma, el evento existe sí o sí. Así nunca se pierde un cambio por sincronizar.
 *
 * Debe llamarse dentro de `db.transaction('rw', [..., db.sync_queue], ...)`.
 */
export async function enqueue(table: SyncTable, recordId: string, op: SyncOperation, payload: unknown) {
  // Compactación: si ya hay un upsert pendiente del mismo registro, se reemplaza el payload.
  const pending = await db.sync_queue
    .where('[table+record_id]')
    .equals([table, recordId])
    .filter((e) => e.status === 'pending')
    .first();

  if (pending?.seq !== undefined) {
    await db.sync_queue.update(pending.seq, { op, payload, created_at: nowISO() });
    return;
  }

  await db.sync_queue.add({
    id: uuidv7(),
    table,
    record_id: recordId,
    op,
    payload,
    status: 'pending',
    attempts: 0,
    last_error: null,
    created_at: nowISO(),
  });
}

export interface OutboxItem {
  table: SyncTable;
  record_id: string;
  op: SyncOperation;
  payload: unknown;
}

/** Igual que `enqueue`, para miles de cambios: lee los pendientes una sola vez y escribe todo junto. */
export async function enqueueMany(items: OutboxItem[]): Promise<void> {
  const pending = await db.sync_queue.where('status').equals('pending').toArray();
  const byRecord = new Map(pending.map((e) => [`${e.table}:${e.record_id}`, e]));
  const writes = new Map<string, SyncQueueEntry>();
  const now = nowISO();

  for (const { table, record_id, op, payload } of items) {
    const key = `${table}:${record_id}`;
    const existing = byRecord.get(key);
    const entry: SyncQueueEntry = existing
      ? { ...existing, op, payload, created_at: now }
      : { id: uuidv7(), table, record_id, op, payload, status: 'pending', attempts: 0, last_error: null, created_at: now };
    byRecord.set(key, entry);
    writes.set(key, entry);
  }
  await db.sync_queue.bulkPut([...writes.values()]);
}

export function newMeta(deviceId: string): SyncMeta {
  const now = nowISO();
  return { created_at: now, updated_at: now, deleted_at: null, version: 1, updated_by_device: deviceId };
}

export function touchMeta<T extends SyncMeta>(record: T, deviceId: string): T {
  return { ...record, updated_at: nowISO(), version: record.version + 1, updated_by_device: deviceId };
}
