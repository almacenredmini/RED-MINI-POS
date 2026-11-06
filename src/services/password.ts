const ITERATIONS = 200_000;

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  // crypto.subtle sólo existe en HTTPS o localhost.
  if (!crypto.subtle) throw new Error('INSECURE_CONTEXT');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return toHex(bits);
}

/** Formato `pbkdf2$iteraciones$sal$hash`: permite subir las iteraciones sin invalidar lo ya guardado. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${toHex(salt)}$${await derive(password, salt, ITERATIONS)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, iterations, salt, hash] = stored.split('$');
  if (!iterations || !salt || !hash) return false;
  return (await derive(password, fromHex(salt), Number(iterations))) === hash;
}
