import { describe, expect, it } from 'vitest';
import { cutEmailSubject } from './cutEmail';
import { diffText, withinTolerance } from './cashDiff';

describe('tolerancia del corte', () => {
  it('hasta $1.000 de sobrante o faltante la caja cuadra', () => {
    expect(withinTolerance(0)).toBe(true);
    expect(withinTolerance(100_000)).toBe(true);
    expect(withinTolerance(-100_000)).toBe(true);
    expect(withinTolerance(100_001)).toBe(false);
    expect(withinTolerance(-150_000)).toBe(false);
    expect(diffText(-150_000)).toMatch(/^Faltan \$/);
  });

  it('el asunto del mail sólo marca la diferencia si pasa la tolerancia', () => {
    const base = { storeName: 'Oroño', cashier: 'Cami', openedAt: '2026-11-27T12:00:00Z', closedAt: '2026-11-27T20:00:00Z' };
    const cut = (counted: number) => ({ cashInDrawer: 1_000_000, counted }) as never;
    expect(cutEmailSubject({ ...base, cut: cut(950_000) } as never)).not.toContain('FALTAN');
    expect(cutEmailSubject({ ...base, cut: cut(850_000) } as never)).toContain('FALTAN $');
    expect(cutEmailSubject({ ...base, cut: cut(1_200_000) } as never)).toContain('SOBRAN $');
  });
});
