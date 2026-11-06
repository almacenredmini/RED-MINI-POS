import { db } from '../db';
import { getDeviceId } from '../meta';
import { enqueue, newMeta, touchMeta } from '../outbox';
import { uuidv7 } from '@/services/id';
import type { Supplier } from '@/types/domain';

export type SupplierInput = Pick<Supplier, 'name' | 'tax_id' | 'phone' | 'email' | 'notes' | 'active'>;

export class SupplierError extends Error {}

export async function listSuppliers(): Promise<Supplier[]> {
  const rows = await db.suppliers.orderBy('name').toArray();
  return rows.filter((s) => !s.deleted_at);
}

export async function saveSupplier(input: SupplierInput, existingId?: string): Promise<Supplier> {
  const name = input.name.trim();
  if (!name) throw new SupplierError('Ingresá el nombre del proveedor');
  const deviceId = await getDeviceId();
  const taxId = input.tax_id?.trim() || null;

  return db.transaction('rw', db.suppliers, db.sync_queue, async () => {
    if (taxId) {
      const taken = await db.suppliers.filter((s) => s.tax_id === taxId && !s.deleted_at && s.id !== existingId).first();
      if (taken) throw new SupplierError(`El CUIT ya pertenece a ${taken.name}`);
    }
    const previous = existingId ? await db.suppliers.get(existingId) : undefined;
    const fields = {
      name,
      tax_id: taxId,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      notes: input.notes?.trim() || null,
      active: input.active,
    };
    const supplier: Supplier = previous ? { ...touchMeta(previous, deviceId), ...fields } : { id: uuidv7(), ...newMeta(deviceId), ...fields };
    await db.suppliers.put(supplier);
    await enqueue('suppliers', supplier.id, 'upsert', supplier);
    return supplier;
  });
}
