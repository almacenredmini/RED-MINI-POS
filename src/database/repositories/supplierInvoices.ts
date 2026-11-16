import { db } from '../db';
import { getDeviceId } from '../meta';
import { enqueue, newMeta, touchMeta } from '../outbox';
import { nowISO, uuidv7 } from '@/services/id';
import { parseMoney } from '@/services/money';
import type { Cents, Supplier, SupplierInvoice, SupplierInvoiceItem, UUID } from '@/types/domain';

/**
 * Boletas de proveedores: un registro para control.
 * Se guardan tal como vienen impresas. No se vinculan con los productos ni tocan stock o costos.
 */

export class InvoiceError extends Error {}

/** "Distribuidora Norte S.A." → "DISTRIBUIDORA NORTE S A": para reconocer al proveedor aunque cambie la escritura. */
export const normName = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

export interface InvoiceDraft {
  supplier_name: string;
  issued_on: string | null;
  number: string | null;
  total_cents: Cents | null;
  items: SupplierInvoiceItem[];
}

/** Número que puede venir como 21000, "21.000,00" o "21000.5". */
function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const cents = parseMoney(v);
  return cents === null ? null : cents / 100;
}

/**
 * Lee lo que se copió del artefacto "Precios de proveedores".
 * Acepta el texto con basura alrededor (por ejemplo, si el celular agrega algo al pegar).
 */
export function parsePastedInvoice(text: string): InvoiceDraft {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new InvoiceError('No encontré una boleta en lo que pegaste. Copiala de nuevo desde el artefacto.');
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new InvoiceError('Lo que pegaste está incompleto. Copiala de nuevo desde el artefacto.');
  }
  const rawItems = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
  const items = rawItems
    .map((it) => {
      const quantity = toNumber(it?.cantidad) ?? 1;
      const unit = toNumber(it?.unitario);
      return { name: String(it?.producto ?? '').trim(), quantity: quantity > 0 ? quantity : 1, unit_cents: unit === null ? 0 : Math.round(unit * 100) };
    })
    .filter((it) => it.name);
  if (items.length === 0) throw new InvoiceError('La boleta no tiene artículos.');
  const total = toNumber(data.total);
  const fecha = typeof data.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.fecha) ? data.fecha : null;
  return {
    supplier_name: String(data.proveedor ?? '').trim(),
    issued_on: fecha,
    number: String(data.comprobante ?? '').trim() || null,
    total_cents: total === null ? null : Math.round(total * 100),
    items,
  };
}

export function findSupplier(suppliers: Supplier[], name: string): Supplier | undefined {
  const n = normName(name);
  if (!n) return undefined;
  return suppliers.find((s) => !s.deleted_at && normName(s.name) === n);
}

export async function listInvoices(storeId: UUID | null): Promise<SupplierInvoice[]> {
  const rows = storeId ? await db.supplier_invoices.where('store_id').equals(storeId).toArray() : await db.supplier_invoices.toArray();
  return rows.filter((i) => !i.deleted_at).sort((a, b) => (b.issued_on ?? '').localeCompare(a.issued_on ?? '') || b.created_at.localeCompare(a.created_at));
}

export interface InvoiceInput {
  store_id: UUID;
  supplier_id: UUID | null;
  supplier_name: string;
  issued_on: string | null;
  number: string | null;
  total_cents: Cents | null;
  items: SupplierInvoiceItem[];
  user_id: UUID | null;
}

export async function saveInvoice(input: InvoiceInput, existingId?: UUID): Promise<SupplierInvoice> {
  const supplierName = input.supplier_name.trim();
  if (!supplierName) throw new InvoiceError('Ingresá el proveedor');
  const items = input.items.map((it) => ({ name: it.name.trim(), quantity: it.quantity, unit_cents: it.unit_cents })).filter((it) => it.name);
  if (items.length === 0) throw new InvoiceError('Agregá al menos un artículo');
  for (const it of items) {
    if (!(it.quantity > 0)) throw new InvoiceError(`Revisá la cantidad de ${it.name}`);
    if (!(it.unit_cents > 0)) throw new InvoiceError(`Revisá el precio de ${it.name}`);
  }
  const deviceId = await getDeviceId();
  return db.transaction('rw', db.supplier_invoices, db.sync_queue, async () => {
    const previous = existingId ? await db.supplier_invoices.get(existingId) : undefined;
    const fields = {
      store_id: input.store_id,
      supplier_id: input.supplier_id,
      supplier_name: supplierName,
      issued_on: input.issued_on || null,
      number: input.number?.trim() || null,
      total_cents: input.total_cents,
      items,
      user_id: previous?.user_id ?? input.user_id,
    };
    const invoice: SupplierInvoice = previous ? { ...touchMeta(previous, deviceId), ...fields } : { id: uuidv7(), ...newMeta(deviceId), ...fields };
    await db.supplier_invoices.put(invoice);
    await enqueue('supplier_invoices', invoice.id, 'upsert', invoice);
    return invoice;
  });
}

export async function deleteInvoice(id: UUID): Promise<void> {
  const deviceId = await getDeviceId();
  await db.transaction('rw', db.supplier_invoices, db.sync_queue, async () => {
    const inv = await db.supplier_invoices.get(id);
    if (!inv) return;
    const removed = { ...touchMeta(inv, deviceId), deleted_at: nowISO() };
    await db.supplier_invoices.put(removed);
    await enqueue('supplier_invoices', id, 'upsert', removed);
  });
}
