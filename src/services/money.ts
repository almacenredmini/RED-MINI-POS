import type { Cents } from '@/types/domain';

const formatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(cents: Cents): string {
  return formatter.format(cents / 100);
}

/** Acepta "1.234,50", "1234.5", "1234,5", "$ 1.234". Devuelve null si no es válido. */
export function parseMoney(input: string): Cents | null {
  const clean = input.replace(/[^\d.,-]/g, '').trim();
  if (clean === '' || clean === '-') return null;

  const lastComma = clean.lastIndexOf(',');
  const lastDot = clean.lastIndexOf('.');
  let normalized: string;

  if (lastComma > lastDot) {
    // Formato AR: el punto es separador de miles.
    normalized = clean.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma && lastComma !== -1) {
    normalized = clean.replace(/,/g, '');
  } else if (lastDot !== -1 && (clean.indexOf('.') !== lastDot || clean.length - lastDot - 1 === 3)) {
    // "1.234" o "1.234.567" sin coma: en es-AR el punto es separador de miles.
    normalized = clean.replace(/\./g, '');
  } else {
    normalized = clean;
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

export function centsToInput(cents: Cents): string {
  return (cents / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Margen sobre precio de venta: (precio − costo) / precio. */
export function marginPct(cost: Cents, price: Cents): number | null {
  if (price <= 0) return null;
  return ((price - cost) / price) * 100;
}

/** Recargo sobre costo (lo que Eleventa llama "% de ganancia"): (precio − costo) / costo. */
export function markupPct(cost: Cents, price: Cents): number | null {
  if (cost <= 0) return null;
  return ((price - cost) / cost) * 100;
}

export function priceFromMarkup(cost: Cents, markup: number): Cents {
  return Math.round(cost * (1 + markup / 100));
}
