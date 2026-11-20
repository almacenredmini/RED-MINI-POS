import type { CashPromo, Cents, DiscountMethod } from '@/types/domain';

/**
 * Descuentos (Productos → Descuentos): un % según la forma de pago, sobre todo o sobre ciertas
 * categorías, en ciertos días y horarios. Lo que paga el cliente se redondea para abajo (a su favor):
 * con 10% y redondeo a $100, una compra de $1.500 queda en $1.300 (descuento de $200).
 * Si a un producto le tocan dos descuentos, vale el mayor: no se suman.
 */

export const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const;

export const METHOD_NAMES: Record<DiscountMethod, string> = { cash: 'Efectivo', card: 'Tarjeta/QR', transfer: 'Transferencia' };
export const ALL_METHODS: DiscountMethod[] = ['cash', 'card', 'transfer'];

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** ¿Vale en este momento? Un horario como 22:00 a 02:00 pasa la medianoche (y cuenta como del día en que empezó). */
export function promoAppliesAt(p: Pick<CashPromo, 'active' | 'deleted_at' | 'days' | 'from_time' | 'to_time'>, now: Date): boolean {
  if (!p.active || p.deleted_at) return false;
  const day = now.getDay();
  const t = now.getHours() * 60 + now.getMinutes();
  if (!p.from_time || !p.to_time) return p.days.includes(day);
  const from = minutes(p.from_time);
  const to = minutes(p.to_time);
  if (from === to) return p.days.includes(day);
  if (from < to) return p.days.includes(day) && t >= from && t < to;
  // Pasa la medianoche: antes de las 24 es del día; después, del día anterior.
  if (t >= from) return p.days.includes(day);
  return t < to && p.days.includes((day + 6) % 7);
}

/** Formas de pago del descuento. Las promos viejas (sin dato) eran sólo de efectivo. */
export const discountMethods = (p: Pick<CashPromo, 'methods'>): DiscountMethod[] => (p.methods?.length ? p.methods : ['cash']);

/** A qué categorías aplica. Las promos viejas guardaban sólo las excluidas. */
export function discountScope(p: Pick<CashPromo, 'category_mode' | 'category_ids' | 'excluded_category_ids'>): { mode: 'all' | 'only' | 'except'; ids: string[] } {
  if (p.category_mode) return { mode: p.category_mode, ids: p.category_mode === 'all' ? [] : (p.category_ids ?? []) };
  const old = p.excluded_category_ids ?? [];
  return old.length ? { mode: 'except', ids: old } : { mode: 'all', ids: [] };
}

/** ¿Este descuento toca a un producto de esta categoría? Los productos comunes (sin categoría) entran en "todo" y "todo menos". */
export function coversCategory(p: Pick<CashPromo, 'category_mode' | 'category_ids' | 'excluded_category_ids'>, categoryId: string | null | undefined): boolean {
  const { mode, ids } = discountScope(p);
  if (mode === 'all') return true;
  const inList = !!categoryId && ids.includes(categoryId);
  return mode === 'only' ? inList : !inList;
}

/** Redondea `payable` para abajo al múltiplo `round`. Si quedara en cero, no redondea. */
function roundDown(payable: Cents, round: number): Cents {
  if (round <= 0) return payable;
  const rounded = Math.floor(payable / round) * round;
  return rounded > 0 ? rounded : payable;
}

/** Cuánto se descuenta de `total` con un solo %. Si redondear dejara la compra en cero, no se redondea. */
export function promoDiscount(total: Cents, p: Pick<CashPromo, 'percent' | 'round_cents'>): Cents {
  if (total <= 0 || p.percent <= 0) return 0;
  const exact = total - Math.round((total * p.percent) / 100);
  return total - roundDown(exact, p.round_cents);
}

const pct = (n: number) => `${String(n).replace('.', ',')}%`;

export interface DiscountLine {
  product_id: string;
  quantity: number;
  unit_price_cents: Cents;
  /** Ya tiene promo por cantidad: no lleva descuento encima. */
  list_price_cents?: Cents;
}

export interface DiscountResult {
  discount: Cents;
  /** Ej.: "Descuento efectivo 10%". Va al ticket y a la venta. */
  label: string;
  /** Categorías de los productos que quedaron sin descuento (para avisar "Sin descuento: Cigarrillos"). */
  skippedCategories: (string | null)[];
}

/**
 * Descuento de la venta si se paga todo con `method`, ahora. A cada producto le toca el mayor %
 * de los descuentos que lo cubren; lo que paga el cliente por esos productos se redondea para abajo
 * con el redondeo más grande de los descuentos que se usaron. Lo que no tiene descuento va a precio lleno.
 */
export function computeDiscount(
  lines: DiscountLine[],
  categoryOf: (productId: string) => string | null | undefined,
  promos: CashPromo[],
  method: DiscountMethod,
  now: Date = new Date(),
): DiscountResult | null {
  const valid = promos.filter((p) => p.percent > 0 && promoAppliesAt(p, now) && discountMethods(p).includes(method));
  if (valid.length === 0) return null;

  let base = 0;
  let exactDiscount = 0;
  let round = 0;
  const used = new Set<CashPromo>();
  const skipped: (string | null)[] = [];
  for (const l of lines) {
    const amount = Math.round(l.quantity * l.unit_price_cents);
    const cat = categoryOf(l.product_id) ?? null;
    const best = l.list_price_cents ? null : valid.filter((p) => coversCategory(p, cat)).sort((a, b) => b.percent - a.percent)[0];
    if (!best) {
      if (!l.list_price_cents && amount > 0) skipped.push(cat);
      continue;
    }
    used.add(best);
    base += amount;
    exactDiscount += Math.round((amount * best.percent) / 100);
    round = Math.max(round, best.round_cents);
  }
  if (base <= 0 || used.size === 0) return null;

  const discount = base - roundDown(base - exactDiscount, round);
  if (discount <= 0) return null;
  const percents = [...new Set([...used].map((p) => p.percent))];
  const label = `Descuento ${METHOD_NAMES[method].toLowerCase().replace("/qr", "/QR")}${percents.length === 1 ? ` ${pct(percents[0]!)}` : ''}`;
  return { discount, label, skippedCategories: [...new Set(skipped)] };
}

/** "Efectivo y Transferencia" */
export function methodsText(p: Pick<CashPromo, 'methods'>): string {
  const names = discountMethods(p).map((m) => METHOD_NAMES[m]);
  return names.length === 3 ? 'Cualquier forma de pago' : names.join(' y ');
}

/** "10% · Efectivo" — para la lista de descuentos. */
export const discountTitle = (p: Pick<CashPromo, 'percent' | 'methods'>) => `${pct(p.percent)} · ${methodsText(p)}`;

/** "Lun a Jue · 14:00 a 18:00" */
export function promoSchedule(p: Pick<CashPromo, 'days' | 'from_time' | 'to_time'>): string {
  const sorted = [...p.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const order = sorted.map((d) => (d + 6) % 7);
  const consecutive = order.length > 2 && order.every((d, i) => i === 0 || d === order[i - 1]! + 1);
  const days =
    p.days.length === 7 ? 'Todos los días' : consecutive ? `${DAY_NAMES[sorted[0]!]} a ${DAY_NAMES[sorted.at(-1)!]}` : sorted.map((d) => DAY_NAMES[d]).join(', ');
  return p.from_time && p.to_time ? `${days} · ${p.from_time} a ${p.to_time}` : `${days} · todo el día`;
}
