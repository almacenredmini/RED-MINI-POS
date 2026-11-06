/**
 * UUID v7 (RFC 9562): 48 bits de timestamp + aleatorio.
 * Se prefiere sobre v4 porque es ordenable por tiempo: los índices B-tree de PostgreSQL
 * y de IndexedDB se insertan al final en vez de fragmentarse.
 */
let lastMs = 0;
let seq = 0;

export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // Contador monotónico (12 bits de rand_a). Arranca en la mitad inferior para tener margen;
  // si se agota, o si el reloj retrocede, se avanza el milisegundo: los ids nunca pierden el orden.
  const start = ((bytes[6]! & 0x07) << 8) | bytes[7]!;
  if (now > lastMs) {
    lastMs = now;
    seq = start;
  } else if (seq < 0xfff) {
    seq += 1;
  } else {
    lastMs += 1;
    seq = start;
  }

  const ms = BigInt(lastMs);
  for (let i = 0; i < 6; i++) {
    bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  }
  bytes[6] = 0x70 | (seq >> 8);
  bytes[7] = seq & 0xff;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function nowISO(): string {
  return new Date().toISOString();
}
