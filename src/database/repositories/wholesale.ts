import { db } from '../db';
import { getDeviceId, getMeta, setMeta } from '../meta';
import { enqueue, newMeta, touchMeta } from '../outbox';
import { nowISO, uuidv7 } from '@/services/id';
import type { Cents, Store, UUID, WholesaleCustomer, WholesaleItem, WholesaleMethod, WholesaleSale } from '@/types/domain';

/**
 * Mayorista: ventas extraordinarias con los productos del catálogo.
 * No tocan el stock, la caja ni las ventas del local. Cantidad, costo y precio se cargan en cada ticket.
 * Clientes y tickets se comparten entre sucursales.
 */

export class WholesaleError extends Error {}

export const WHOLESALE_METHODS: { value: WholesaleMethod; label: string }[] = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'card', label: 'Tarjeta/QR' },
  { value: 'transfer', label: 'Transferencia' },
];
export const methodLabel = (m: WholesaleMethod | null) => WHOLESALE_METHODS.find((x) => x.value === m)?.label ?? 'Sin medio de pago';

const clean = (s: string | null | undefined) => s?.trim() || null;

// ——— Clientes ———

export async function listCustomers(): Promise<WholesaleCustomer[]> {
  const rows = await db.wholesale_customers.toArray();
  return rows.filter((c) => !c.deleted_at).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export interface CustomerInput {
  name: string;
  phone?: string | null;
  tax_id?: string | null;
  address?: string | null;
  notes?: string | null;
}

export async function saveCustomer(input: CustomerInput, existingId?: UUID): Promise<WholesaleCustomer> {
  const name = input.name.trim();
  if (!name) throw new WholesaleError('Ingresá el nombre del cliente');
  const deviceId = await getDeviceId();
  return db.transaction('rw', db.wholesale_customers, db.sync_queue, async () => {
    const twin = (await db.wholesale_customers.toArray()).find((c) => !c.deleted_at && c.id !== existingId && c.name.toLowerCase() === name.toLowerCase());
    if (twin) throw new WholesaleError(`Ya hay un cliente llamado ${twin.name}`);
    const previous = existingId ? await db.wholesale_customers.get(existingId) : undefined;
    const fields = { name, phone: clean(input.phone), tax_id: clean(input.tax_id), address: clean(input.address), notes: clean(input.notes) };
    const row: WholesaleCustomer = previous ? { ...touchMeta(previous, deviceId), ...fields } : { id: uuidv7(), ...newMeta(deviceId), ...fields };
    await db.wholesale_customers.put(row);
    await enqueue('wholesale_customers', row.id, 'upsert', row);
    return row;
  });
}

export async function deleteCustomer(id: UUID): Promise<void> {
  const deviceId = await getDeviceId();
  await db.transaction('rw', db.wholesale_customers, db.sync_queue, async () => {
    const current = await db.wholesale_customers.get(id);
    if (!current) return;
    const row = { ...touchMeta(current, deviceId), deleted_at: nowISO() };
    await db.wholesale_customers.put(row);
    await enqueue('wholesale_customers', row.id, 'upsert', row);
  });
}

// ——— Tickets ———

/** Todas las sucursales; lo más nuevo primero. Incluye los anulados (se ven tachados). */
export async function listWholesaleSales(): Promise<WholesaleSale[]> {
  const rows = await db.wholesale_sales.toArray();
  return rows.filter((s) => !s.deleted_at).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
}

export const lineTotal = (i: Pick<WholesaleItem, 'quantity' | 'price_cents'>) => Math.round(i.quantity * i.price_cents);
export const lineCost = (i: Pick<WholesaleItem, 'quantity' | 'cost_cents'>) => Math.round(i.quantity * i.cost_cents);

export interface WholesaleInput {
  store: Pick<Store, 'id' | 'code'>;
  customer: Pick<WholesaleCustomer, 'id' | 'name'> | null;
  items: WholesaleItem[];
  method: WholesaleMethod | null;
  paid: boolean;
  notes?: string | null;
  userId: UUID | null;
}

/** Sucursal + dispositivo + secuencia propia, como los tickets del local pero con M adelante: M-ORO-F757-00012. */
const wholesaleNumber = (storeCode: string, deviceId: string, seq: number) => `M-${storeCode}-${deviceId.slice(-4).toUpperCase()}-${String(seq).padStart(5, '0')}`;

export async function saveWholesaleSale(input: WholesaleInput, existingId?: UUID): Promise<WholesaleSale> {
  const items = input.items.map((i) => ({ ...i, name: i.name.trim() })).filter((i) => i.name);
  if (items.length === 0) throw new WholesaleError('Agregá al menos un producto');
  for (const i of items) {
    if (!(i.quantity > 0)) throw new WholesaleError(`Revisá la cantidad de ${i.name}`);
    if (!(i.price_cents > 0)) throw new WholesaleError(`Ingresá el precio de venta de ${i.name}`);
    if (!(i.cost_cents >= 0)) throw new WholesaleError(`Revisá el costo de ${i.name}`);
  }
  if (!input.paid && !input.customer) throw new WholesaleError('Para dejarlo debiendo, elegí el cliente');
  if (input.paid && !input.method) throw new WholesaleError('Elegí cómo pagó');

  const deviceId = await getDeviceId();
  return db.transaction('rw', db.wholesale_sales, db.sync_queue, db.meta, async () => {
    const previous = existingId ? await db.wholesale_sales.get(existingId) : undefined;
    if (previous?.voided_at) throw new WholesaleError('El ticket está anulado');
    const now = nowISO();
    const fields = {
      customer_id: input.customer?.id ?? null,
      customer_name: input.customer?.name ?? null,
      items,
      total_cents: items.reduce((t, i) => t + lineTotal(i), 0),
      cost_cents: items.reduce((t, i) => t + lineCost(i), 0),
      method: input.method,
      paid_at: input.paid ? (previous?.paid_at ?? now) : null,
      notes: clean(input.notes),
    };
    let row: WholesaleSale;
    if (previous) {
      row = { ...touchMeta(previous, deviceId), ...fields };
    } else {
      const key = `wholesale_seq:${input.store.id}`;
      const seq = ((await getMeta<number>(key)) ?? 0) + 1;
      await setMeta(key, seq);
      row = {
        id: uuidv7(),
        ...newMeta(deviceId),
        ...fields,
        store_id: input.store.id,
        number: wholesaleNumber(input.store.code, deviceId, seq),
        occurred_at: now,
        user_id: input.userId,
        voided_at: null,
        voided_by: null,
      };
    }
    await db.wholesale_sales.put(row);
    await enqueue('wholesale_sales', row.id, 'upsert', row);
    return row;
  });
}

async function change(id: UUID, edit: (row: WholesaleSale) => Partial<WholesaleSale>): Promise<void> {
  const deviceId = await getDeviceId();
  await db.transaction('rw', db.wholesale_sales, db.sync_queue, async () => {
    const current = await db.wholesale_sales.get(id);
    if (!current) return;
    const row = { ...touchMeta(current, deviceId), ...edit(current) };
    await db.wholesale_sales.put(row);
    await enqueue('wholesale_sales', row.id, 'upsert', row);
  });
}

/** Marca el ticket como cobrado (con su medio de pago) o lo vuelve a dejar debiendo. */
export function setWholesalePaid(id: UUID, paid: boolean, method?: WholesaleMethod): Promise<void> {
  return change(id, (s) => (paid ? { paid_at: nowISO(), method: method ?? s.method } : { paid_at: null }));
}

export function voidWholesaleSale(id: UUID, userId: UUID | null): Promise<void> {
  return change(id, () => ({ voided_at: nowISO(), voided_by: userId }));
}

const counts = (s: WholesaleSale) => !s.deleted_at && !s.voided_at;

/** Lo que debe cada cliente: la suma de sus tickets sin cobrar. */
export async function customerDebts(): Promise<Map<UUID, Cents>> {
  const out = new Map<UUID, Cents>();
  for (const s of await db.wholesale_sales.toArray()) {
    if (!counts(s) || s.paid_at || !s.customer_id) continue;
    out.set(s.customer_id, (out.get(s.customer_id) ?? 0) + s.total_cents);
  }
  return out;
}

// ——— Reportes ———

export interface WholesaleReport {
  tickets: number;
  total: Cents;
  cost: Cents;
  paid: Cents;
  pending: Cents;
  byMethod: { method: WholesaleMethod; total: Cents }[];
  byCustomer: { key: string; label: string; tickets: number; total: Cents; cost: Cents; pending: Cents }[];
}

/** Ventas extraordinarias del período [from, to). No se mezclan con las ventas del local. */
export async function wholesaleReport(storeId: UUID | null, from: string, to: string): Promise<WholesaleReport> {
  const rows = (await db.wholesale_sales.where('occurred_at').between(from, to, true, false).toArray()).filter((s) => counts(s) && (!storeId || s.store_id === storeId));
  const methods = new Map<WholesaleMethod, Cents>();
  const customers = new Map<string, WholesaleReport['byCustomer'][number]>();
  const report: WholesaleReport = { tickets: rows.length, total: 0, cost: 0, paid: 0, pending: 0, byMethod: [], byCustomer: [] };
  for (const s of rows) {
    report.total += s.total_cents;
    report.cost += s.cost_cents;
    if (s.paid_at) {
      report.paid += s.total_cents;
      if (s.method) methods.set(s.method, (methods.get(s.method) ?? 0) + s.total_cents);
    } else report.pending += s.total_cents;
    const key = s.customer_id ?? 'none';
    const c = customers.get(key) ?? { key, label: s.customer_name ?? 'Sin cliente', tickets: 0, total: 0, cost: 0, pending: 0 };
    c.tickets += 1;
    c.total += s.total_cents;
    c.cost += s.cost_cents;
    if (!s.paid_at) c.pending += s.total_cents;
    customers.set(key, c);
  }
  report.byMethod = [...methods].map(([method, total]) => ({ method, total })).sort((a, b) => b.total - a.total);
  report.byCustomer = [...customers.values()].sort((a, b) => b.total - a.total);
  return report;
}
