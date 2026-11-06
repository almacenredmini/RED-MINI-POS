import { describe, expect, it } from 'vitest';
import { marginPct, markupPct, parseMoney, priceFromMarkup } from './money';
import { uuidv7 } from './id';

describe('parseMoney', () => {
  it.each([
    ['1.234,50', 123450],
    ['1234,5', 123450],
    ['1234.5', 123450],
    ['1.234', 123400],
    ['1.234.567', 123456700],
    ['$ 2.500', 250000],
    ['12.5', 1250],
    ['0,99', 99],
  ])('%s → %i', (input, cents) => expect(parseMoney(input)).toBe(cents));

  it('rechaza vacío', () => expect(parseMoney('')).toBeNull());
});

describe('márgenes', () => {
  it('margen sobre venta y recargo sobre costo', () => {
    expect(marginPct(1000, 1500)).toBeCloseTo(33.33, 1);
    expect(markupPct(1000, 1500)).toBe(50);
    expect(priceFromMarkup(1000, 50)).toBe(1500);
  });
});

describe('uuidv7', () => {
  it('formato válido y orden temporal', () => {
    const ids = Array.from({ length: 500 }, () => uuidv7());
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('mantiene el orden si se agota el contador o el reloj retrocede', () => {
    const now = Date.now() + 1000;
    const burst = Array.from({ length: 10_000 }, () => uuidv7(now));
    const after = uuidv7(now - 500);
    const ids = [...burst, after];
    expect([...ids].sort()).toEqual(ids);
  });
});
