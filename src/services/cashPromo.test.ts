import { describe, expect, it } from 'vitest';
import { currentPromo, promoAppliesAt, promoBase, promoDiscount, promoLabel, promoSchedule } from './cashPromo';
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

describe('promo efectivo', () => {
  it('redondea lo que paga para abajo, a favor del cliente', () => {
    const p = promo();
    expect(promoDiscount(150000, p)).toBe(20000); // $1.500 → paga $1.300
    expect(promoDiscount(153000, p)).toBe(23000); // $1.530 → $1.377 → $1.300
    expect(promoDiscount(248000, p)).toBe(28000); // $2.480 → $2.232 → $2.200
    expect(promoDiscount(200000, p)).toBe(20000); // justo: $1.800
  });

  it('sin redondeo descuenta el porcentaje exacto', () => {
    expect(promoDiscount(153000, promo({ round_cents: 0 }))).toBe(15300);
  });

  it('si redondear dejara la compra en cero, no redondea', () => {
    expect(promoDiscount(8000, promo())).toBe(800); // $80 → paga $72, no $0
  });

  it('vale sólo los días y el horario elegidos', () => {
    const p = promo({ days: [1, 2, 3, 4], from_time: '14:00', to_time: '18:00' });
    expect(promoAppliesAt(p, at(1, '14:00'))).toBe(true);
    expect(promoAppliesAt(p, at(1, '17:59'))).toBe(true);
    expect(promoAppliesAt(p, at(1, '18:00'))).toBe(false);
    expect(promoAppliesAt(p, at(1, '13:59'))).toBe(false);
    expect(promoAppliesAt(p, at(5, '15:00'))).toBe(false); // viernes
  });

  it('un horario que pasa la medianoche cuenta como del día en que empezó', () => {
    const p = promo({ days: [5], from_time: '22:00', to_time: '02:00' }); // viernes a la noche
    expect(promoAppliesAt(p, at(5, '23:00'))).toBe(true);
    expect(promoAppliesAt(p, at(6, '01:30'))).toBe(true); // sábado de madrugada
    expect(promoAppliesAt(p, at(6, '23:00'))).toBe(false);
    expect(promoAppliesAt(p, at(5, '01:00'))).toBe(false); // madrugada del viernes = jueves
  });

  it('pausada o borrada no vale; si se pisan dos, gana la de mayor porcentaje', () => {
    expect(promoAppliesAt(promo({ active: false }), at(1, '10:00'))).toBe(false);
    expect(promoAppliesAt(promo({ deleted_at: '2026-11-02T00:00:00Z' }), at(1, '10:00'))).toBe(false);
    const best = currentPromo([promo({ id: 'a', percent: 5 }), promo({ id: 'b', percent: 15 }), promo({ id: 'c', percent: 20, active: false })], at(1, '10:00'));
    expect(best?.id).toBe('b');
  });

  it('las categorías excluidas (cigarrillos) van a precio lleno y no entran en el redondeo', () => {
    const p = promo({ excluded_category_ids: ['cig'] });
    const lines = [
      { product_id: 'marlboro', quantity: 1, unit_price_cents: 325000 },
      { product_id: 'fernet', quantity: 1, unit_price_cents: 153000 },
      { product_id: 'comun:1', quantity: 1, unit_price_cents: 10000 },
    ];
    const cat = (id: string) => ({ marlboro: 'cig', fernet: 'beb' })[id] ?? null;
    const base = promoBase(lines, cat, p);
    expect(base).toBe(163000); // fernet + producto común
    expect(promoDiscount(base, p)).toBe(23000); // $1.630 → $1.467 → $1.400; el Marlboro sigue en $3.250
    expect(promoBase(lines, cat, promo())).toBe(488000);
  });

  it('se describe en palabras', () => {
    expect(promoLabel(promo({ percent: 7.5 }))).toBe('Promo efectivo 7,5%');
    expect(promoSchedule(promo({ days: [4, 1, 2, 3], from_time: '14:00', to_time: '18:00' }))).toBe('Lun a Jue · 14:00 a 18:00');
    expect(promoSchedule(promo({ days: [0, 6] }))).toBe('Sáb, Dom · todo el día');
    expect(promoSchedule(promo())).toBe('Todos los días · todo el día');
  });
});
