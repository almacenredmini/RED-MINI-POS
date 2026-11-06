/** Normaliza texto para búsqueda: minúsculas, sin acentos, sólo alfanumérico. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();
}

export function tokenize(text: string): string[] {
  const n = normalize(text);
  return n === '' ? [] : n.split(' ');
}

/** Palabras indexadas de un producto (nombre + marca + SKU), sin duplicados. */
export function buildSearchWords(...parts: Array<string | null | undefined>): string[] {
  const words = new Set<string>();
  for (const part of parts) {
    if (part) for (const w of tokenize(part)) words.add(w);
  }
  return [...words];
}
