import { describe, expect, it } from 'vitest';
import { computeDiscount, coversCategory, discountTitle, promoAppliesAt, promoDiscount, promoSchedule } from './cashPromo';
import type { CashPromo } from '@/types/domain';

const promo = (over: Partial<CashPromo> = {}): CashPromo => ({
  id: 'p1',
  store_id: 's1',
  active: true,
  percent: 10,
  days: [0, 1, 2, 3, 4, 5, 6],
  from_time: null,
  to_time: null,
  round_cents: 10000,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  deleted_at: null,
  version: 1,
  updated_by_device: 'd',
  ...over,
});

/** 2026-11-16 es lunes. */
const at = (day: number, hhmm: string) => new Date(`2026-11-${String(16 + ((day + 6) % 7)).padStart(2, '0')}T${hhmm}:00`);
const monday = at(1, '10:00');

const lines = [
  { product_id: 'marlboro', quantity: 1, unit_price_cents: 325000 },
  { product_id: 'fernet', quantity: 1, unit_price_cents: 153000 },
  { product_id: 'comun:1', quantity: 1, unit_price_cents: 10000 },
];
const cat = (id: string) => ({ marlboro: 'cig', fernet: 'beb' })[id] ?? null;

describe('descuentos', () => {
  it('redondea lo que paga para abajo, a favor del cliente', () => {
    const p = promo();
    expect(promoDiscount(150000, p)).toBe(20000); // $1.500 → paga $1.300
    expect(promoDiscount(153000, p)).toBe(23000); // $1.530 → $1.377 → $1.300
    expect(promoDiscount(248000, p)).toBe(28000); // $2.480 → $2.232 → $2.200
    expect(promoDiscount(200000, p)).toBe(20000); // justo: $1.800
    expect(promoDiscount(153000, promo({ round_cents: 0 }))).toBe(15300); // sin redondeo
    expect(promoDiscount(8000, p)).toBe(800); // $80 → paga $72, no $0
  });

  it('vale sólo los días y el horario elegidos', () => {
    const p = promo({ days: [1, 2, 3, 4], from_time: '14:00', to_time: '18:00' });
    expect(promoAppliesAt(p, at(1, '14:00'))).toBe(true);
    expect(promoAppliesAt(p, at(1, '17:59'))).toBe(true);
    expect(promoAppliesAt(p, at(1, '18:00'))).toBe(false);
    expect(promoAppliesAt(p, at(1, '13:59'))).toBe(false);
    expect(promoAppliesAt(p, at(5, '15:00'))).toBe(false); // viernes
    expect(promoAppliesAt(promo({ active: false }), monday)).toBe(false);
    expect(promoAppliesAt(promo({ deleted_at: '2026-11-02T00:00:00Z' }), monday)).toBe(false);
  });

  it('un horario que pasa la medianoche cuenta como del día en que empezó', () => {
    const p = promo({ days: [5], from_time: '22:00', to_time: '02:00' }); // viernes a la noche
    expect(promoAppliesAt(p, at(5, '23:00'))).toBe(true);
    expect(promoAppliesAt(p, at(6, '01:30'))).toBe(true); // sábado de madrugada
    expect(promoAppliesAt(p, at(6, '23:00'))).toBe(false);
    expect(promoAppliesAt(p, at(5, '01:00'))).toBe(false); // madrugada del viernes = jueves
  });

  it('sólo vale con las formas de pago elegidas; las promos viejas son de efectivo', () => {
    const old = promo();
    expect(computeDiscount(lines, cat, [old], 'cash', monday)?.discount).toBe(58000); // $4.880 → $4.392 → $4.300
    expect(computeDiscount(lines, cat, [old], 'card', monday)).toBeNull();
    const transfer = promo({ methods: ['transfer', 'card'] });
    expect(computeDiscount(lines, cat, [transfer], 'card', monday)?.label).toBe('Descuento tarjeta 10%');
    expect(computeDiscount(lines, cat, [transfer], 'cash', monday)).toBeNull();
  });

  it('"todo menos" deja las categorías excluidas a precio lleno y fuera del redondeo', () => {
    const p = promo({ category_mode: 'except', category_ids: ['cig'] });
    const r = computeDiscount(lines, cat, [p], 'cash', monday);
    expect(r?.discount).toBe(23000); // fernet + común = $1.630 → $1.467 → $1.400; el Marlboro sigue en $3.250
    expect(r?.skippedCategories).toEqual(['cig']);
    // Formato viejo: sólo traía las excluidas.
    expect(computeDiscount(lines, cat, [promo({ excluded_category_ids: ['cig'] })], 'cash', monday)?.discount).toBe(23000);
  });

  it('"sólo estas categorías" no toca lo demás ni los productos comunes', () => {
    const p = promo({ category_mode: 'only', category_ids: ['beb'], round_cents: 0 });
    const r = computeDiscount(lines, cat, [p], 'cash', monday);
    expect(r?.discount).toBe(15300);
    expect(r?.skippedCategories).toEqual(['cig', null]);
    expect(coversCategory(p, null)).toBe(false);
    expect(coversCategory(promo({ category_mode: 'except', category_ids: ['cig'] }), null)).toBe(true);
  });

  it('si a un producto le tocan dos descuentos, vale el mayor; no se suman', () => {
    const all5 = promo({ id: 'a', percent: 5, round_cents: 0 });
    const beb20 = promo({ id: 'b', percent: 20, round_cents: 0, category_mode: 'only', category_ids: ['beb'] });
    const r = computeDiscount(lines, cat, [all5, beb20], 'cash', monday);
    // Marlboro 5% (16250) + Fernet 20% (30600) + común 5% (500)
    expect(r?.discount).toBe(47350);
    expect(r?.label).toBe('Descuento efectivo');
  });

  it('lo que ya tiene promo por cantidad no lleva descuento', () => {
    const withPromo = [{ product_id: 'fernet', quantity: 2, unit_price_cents: 140000, list_price_cents: 153000 }];
    expect(computeDiscount(withPromo, cat, [promo()], 'cash', monday)).toBeNull();
  });

  it('se describe en palabras', () => {
    expect(discountTitle(promo({ percent: 7.5 }))).toBe('7,5% · Efectivo');
    expect(discountTitle(promo({ methods: ['cash', 'card', 'transfer'] }))).toBe('10% · Cualquier forma de pago');
    expect(promoSchedule(promo({ days: [4, 1, 2, 3], from_time: '14:00', to_time: '18:00' }))).toBe('Lun a Jue · 14:00 a 18:00');
    expect(promoSchedule(promo({ days: [0, 6] }))).toBe('Sáb, Dom · todo el día');
    expect(promoSchedule(promo())).toBe('Todos los días · todo el día');
  });
});
