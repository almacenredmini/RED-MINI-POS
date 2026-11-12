import { db } from '../db';
import type { Payment, Sale } from '@/types/domain';

/**
 * Reportes calculados en el dispositivo con lo que tiene en su base local:
 * la PC de un local ve su sucursal; el celular del dueño (sin alcance) ve todas.
 * La ganancia usa el costo guardado en cada ítem al vender, así no cambia si después sube el costo.
 */

export interface Row {
  key: string;
  label: string;
  tickets: number;
  quantity: number;
  total: number;
  cost: number;
}

export interface SalesReport {
  total: number;
  tickets: number;
  cost: number;
  discount: number;
  voided: { count: number; total: number };
  byMethod: Partial<Record<Payment['method'], number>>;
  /** Clave `AAAA-MM-DD` en hora local. */
  byDay: Map<string, number>;
  /** 24 posiciones, una por hora. */
  byHour: { total: number; tickets: number }[];
  byStore: Row[];
  byUser: Row[];
  byCategory: Row[];
  byProduct: Row[];
}

export const localDay = (iso: string | Date) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function bump(map: Map<string, Row>, key: string, label: string, add: Partial<Omit<Row, 'key' | 'label'>>) {
  const row = map.get(key) ?? { key, label, tickets: 0, quantity: 0, total: 0, cost: 0 };
  row.tickets += add.tickets ?? 0;
  row.quantity += add.quantity ?? 0;
  row.total += add.total ?? 0;
  row.cost += add.cost ?? 0;
  map.set(key, row);
}

const byTotal = (a: Row, b: Row) => b.total - a.total;

async function loadSales(storeId: string | null, from: string, to: string): Promise<Sale[]> {
  return storeId
    ? db.sales.where('[store_id+occurred_at]').between([storeId, from], [storeId, to], true, false).toArray()
    : db.sales.where('occurred_at').between(from, to, true, false).toArray();
}

export async function salesReport(storeId: string | null, from: string, to: string): Promise<SalesReport> {
  const all = await loadSales(storeId, from, to);
  const sales = all.filter((s) => s.status === 'completed');
  const voided = all.filter((s) => s.status === 'voided');
  const ids = sales.map((s) => s.id);
  const [items, payments, products, categories, users, stores] = await Promise.all([
    db.sale_items.where('sale_id').anyOf(ids).toArray(),
    db.payments.where('sale_id').anyOf(ids).toArray(),
    db.products.toArray(),
    db.categories.toArray(),
    db.users.toArray(),
    db.stores.toArray(),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const storeName = new Map(stores.map((s) => [s.id, s.name]));

  // El costo de una venta es el de sus ítems; el descuento general se reparte en proporción al total.
  const costBySale = new Map<string, number>();
  for (const i of items) costBySale.set(i.sale_id, (costBySale.get(i.sale_id) ?? 0) + Math.round(i.unit_cost_cents * i.quantity));
  const saleById = new Map(sales.map((s) => [s.id, s]));

  const byMethod: SalesReport['byMethod'] = {};
  for (const p of payments) byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount_cents;

  const byDay = new Map<string, number>();
  const byHour = Array.from({ length: 24 }, () => ({ total: 0, tickets: 0 }));
  const stores_ = new Map<string, Row>();
  const users_ = new Map<string, Row>();
  for (const s of sales) {
    const cost = costBySale.get(s.id) ?? 0;
    const day = localDay(s.occurred_at);
    byDay.set(day, (byDay.get(day) ?? 0) + s.total_cents);
    const h = byHour[new Date(s.occurred_at).getHours()]!;
    h.total += s.total_cents;
    h.tickets += 1;
    bump(stores_, s.store_id, storeName.get(s.store_id) ?? 'Sucursal', { tickets: 1, total: s.total_cents, cost });
    bump(users_, s.user_id ?? '-', s.user_id ? (userName.get(s.user_id) ?? 'Usuario borrado') : 'Sin usuario', { tickets: 1, total: s.total_cents, cost });
  }

  const products_ = new Map<string, Row>();
  const categories_ = new Map<string, Row>();
  for (const i of items) {
    const sale = saleById.get(i.sale_id);
    // Parte del descuento general que le toca a este ítem.
    const share = sale && sale.subtotal_cents > 0 ? Math.round((i.total_cents * sale.discount_cents) / sale.subtotal_cents) : 0;
    const total = i.total_cents - share;
    const cost = Math.round(i.unit_cost_cents * i.quantity);
    const product = i.product_id ? productById.get(i.product_id) : undefined;
    bump(products_, i.product_id ?? `libre:${i.description}`, product?.name ?? i.description, { quantity: i.quantity, total, cost });
    const cat = product?.category_id ?? null;
    bump(categories_, cat ?? '-', cat ? (categoryName.get(cat) ?? 'Sin categoría') : 'Sin categoría', { quantity: i.quantity, total, cost });
  }

  return {
    total: sales.reduce((t, s) => t + s.total_cents, 0),
    tickets: sales.length,
    cost: [...costBySale.values()].reduce((t, c) => t + c, 0),
    discount: sales.reduce((t, s) => t + s.discount_cents, 0),
    voided: { count: voided.length, total: voided.reduce((t, s) => t + s.total_cents, 0) },
    byMethod,
    byDay,
    byHour,
    byStore: [...stores_.values()].sort(byTotal),
    byUser: [...users_.values()].sort(byTotal),
    byCategory: [...categories_.values()].sort(byTotal),
    byProduct: [...products_.values()].sort(byTotal),
  };
}

export interface StockValue {
  storeId: string;
  storeName: string;
  units: number;
  /** Productos con stock positivo. */
  products: number;
  cost: number;
  price: number;
  /** Productos con stock negativo: se vendió más de lo cargado. */
  negative: number;
}

/** Stock valorizado por sucursal, a costo y a precio de venta. El stock negativo no suma. */
export async function stockValue(storeId: string | null): Promise<StockValue[]> {
  const [stock, products, stores] = await Promise.all([
    storeId ? db.stock.where('store_id').equals(storeId).toArray() : db.stock.toArray(),
    db.products.toArray(),
    db.stores.toArray(),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const out = new Map<string, StockValue>();
  for (const s of stock) {
    const p = productById.get(s.product_id);
    if (!p || p.deleted_at) continue;
    const row = out.get(s.store_id) ?? { storeId: s.store_id, storeName: stores.find((x) => x.id === s.store_id)?.name ?? 'Sucursal', units: 0, products: 0, cost: 0, price: 0, negative: 0 };
    if (s.quantity < 0) row.negative += 1;
    else if (s.quantity > 0) {
      row.products += 1;
      row.units += s.quantity;
      row.cost += Math.round(s.quantity * (p.cost_cents ?? 0));
      row.price += Math.round(s.quantity * p.price_cents);
    }
    out.set(s.store_id, row);
  }
  return [...out.values()].sort((a, b) => a.storeName.localeCompare(b.storeName));
}

export interface SlowMover {
  productId: string;
  name: string;
  category: string;
  perishable: boolean;
  stock: number;
  /** Unidades vendidas en el período. */
  sold: number;
  lastSale: string | null;
  /** Última vez que entró mercadería (compra, carga inicial, ajuste positivo o transferencia). */
  lastEntry: string | null;
  /** Días desde la última venta o, si nunca se vendió, desde que entró. null = más que lo que se mira hacia atrás. */
  idleDays: number | null;
}

/** Hasta dónde se busca la última venta o entrada. */
export const LOOKBACK_DAYS = 180;

/**
 * Productos con stock que se vendieron `maxSold` unidades o menos en los últimos `days` días.
 * Con `storeId` null suma todas las sucursales del dispositivo.
 */
export async function slowMovers(storeId: string | null, days: number, maxSold = 0, now = new Date()): Promise<SlowMover[]> {
  const since = new Date(now.getTime() - Math.max(days, LOOKBACK_DAYS) * 86_400_000).toISOString();
  const periodStart = new Date(now.getTime() - days * 86_400_000).toISOString();
  const end = now.toISOString();
  const [stock, products, categories, movements] = await Promise.all([
    storeId ? db.stock.where('store_id').equals(storeId).toArray() : db.stock.toArray(),
    db.products.toArray(),
    db.categories.toArray(),
    storeId
      ? db.stock_movements.where('[store_id+occurred_at]').between([storeId, since], [storeId, end], true, true).toArray()
      : db.stock_movements.where('occurred_at').between(since, end, true, true).toArray(),
  ]);

  const qty = new Map<string, number>();
  for (const s of stock) qty.set(s.product_id, (qty.get(s.product_id) ?? 0) + s.quantity);

  const sold = new Map<string, number>();
  const lastSale = new Map<string, string>();
  const lastEntry = new Map<string, string>();
  for (const m of movements) {
    if (m.type === 'sale' || m.type === 'sale_void') {
      if (m.occurred_at >= periodStart) sold.set(m.product_id, (sold.get(m.product_id) ?? 0) - m.quantity);
      if (m.type === 'sale' && (lastSale.get(m.product_id) ?? '') < m.occurred_at) lastSale.set(m.product_id, m.occurred_at);
    } else if (m.quantity > 0 && (lastEntry.get(m.product_id) ?? '') < m.occurred_at) {
      lastEntry.set(m.product_id, m.occurred_at);
    }
  }

  const category = new Map(categories.map((c) => [c.id, c]));
  const out: SlowMover[] = [];
  for (const p of products) {
    if (p.deleted_at || !p.active) continue;
    const stockQty = qty.get(p.id) ?? 0;
    const soldQty = Math.max(0, sold.get(p.id) ?? 0);
    if (stockQty <= 0 || soldQty > maxSold) continue;
    // Recién cargado y todavía sin ventas: no tuvo tiempo de rotar.
    const entry = lastEntry.get(p.id);
    if (!lastSale.has(p.id) && entry && entry >= periodStart) continue;
    const cat = p.category_id ? category.get(p.category_id) : undefined;
    const ref = lastSale.get(p.id) ?? lastEntry.get(p.id) ?? null;
    out.push({
      productId: p.id,
      name: p.name,
      category: cat?.name ?? 'Sin categoría',
      perishable: cat?.perishable === true,
      stock: stockQty,
      sold: soldQty,
      lastSale: lastSale.get(p.id) ?? null,
      lastEntry: lastEntry.get(p.id) ?? null,
      idleDays: ref ? Math.floor((now.getTime() - new Date(ref).getTime()) / 86_400_000) : null,
    });
  }
  // Primero los que llevan más tiempo quietos; los de "más de 180 días" arriba de todo.
  return out.sort((a, b) => (b.idleDays ?? Infinity) - (a.idleDays ?? Infinity) || a.name.localeCompare(b.name));
}
