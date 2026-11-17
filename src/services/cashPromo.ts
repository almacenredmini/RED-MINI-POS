import type { CashPromo, Cents } from '@/types/domain';

/**
 * Promo por pagar en efectivo. Lo que paga el cliente se redondea para abajo (a su favor):
 * con 10% y redondeo a $100, una compra de $1.500 queda en $1.300 (descuento de $200).
 */

export const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const;

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

/** La promo que vale ahora; si se pisan varias, la de mayor porcentaje. */
export function currentPromo<T extends CashPromo>(promos: T[], now: Date = new Date()): T | null {
  return promos.filter((p) => promoAppliesAt(p, now)).sort((a, b) => b.percent - a.percent)[0] ?? null;
}

/** Cuánto se descuenta de `total`. Si redondear dejara la compra en cero, no se redondea. */
export function promoDiscount(total: Cents, p: Pick<CashPromo, 'percent' | 'round_cents'>): Cents {
  if (total <= 0 || p.percent <= 0) return 0;
  const exact = total - Math.round((total * p.percent) / 100);
  const rounded = p.round_cents > 0 ? Math.floor(exact / p.round_cents) * p.round_cents : exact;
  return total - (rounded > 0 ? rounded : Math.max(0, exact));
}

export const promoLabel = (p: Pick<CashPromo, 'percent'>) => `Promo efectivo ${String(p.percent).replace('.', ',')}%`;

/** "Lun a Jue · 14:00 a 18:00" */
export function promoSchedule(p: Pick<CashPromo, 'days' | 'from_time' | 'to_time'>): string {
  const sorted = [...p.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const order = sorted.map((d) => (d + 6) % 7);
  const consecutive = order.length > 2 && order.every((d, i) => i === 0 || d === order[i - 1]! + 1);
  const days =
    p.days.length === 7 ? 'Todos los días' : consecutive ? `${DAY_NAMES[sorted[0]!]} a ${DAY_NAMES[sorted.at(-1)!]}` : sorted.map((d) => DAY_NAMES[d]).join(', ');
  return p.from_time && p.to_time ? `${days} · ${p.from_time} a ${p.to_time}` : `${days} · todo el día`;
}

/**
 * Sobre cuánto se calcula la promo: lo del carrito que no es de una categoría excluida (ej. cigarrillos).
 * Lo excluido se cobra a precio lleno y no entra en el redondeo. Lo que ya tiene promo por cantidad tampoco.
 */
export function promoBase(
  lines: Array<{ product_id: string; quantity: number; unit_price_cents: Cents; list_price_cents?: Cents }>,
  categoryOf: (productId: string) => string | null | undefined,
  p: Pick<CashPromo, 'excluded_category_ids'>,
): Cents {
  const excluded = new Set(p.excluded_category_ids ?? []);
  return lines.reduce((sum, l) => {
    const cat = categoryOf(l.product_id);
    // Lo que ya tiene promo por cantidad no suma otra promo.
    return (cat && excluded.has(cat)) || l.list_price_cents ? sum : sum + Math.round(l.quantity * l.unit_price_cents);
  }, 0);
}
