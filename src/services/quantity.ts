/** Acepta "5", "1,5" y "1.5". Devuelve null si está vacío o no es un número. */
export function parseQuantity(text: string): number | null {
  const clean = text.trim().replace(',', '.');
  if (clean === '') return null;
  const value = Number(clean);
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}
