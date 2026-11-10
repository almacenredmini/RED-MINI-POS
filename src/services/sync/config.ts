import { getMeta, setMeta } from '@/database/meta';
import { db } from '@/database/db';
import type { SupabaseConnection, SupabaseSession } from './supabase';

const KEY = 'sync_config';
export const CURSOR_KEY = 'sync_cursor';
export const LAST_SYNC_KEY = 'sync_last_at';

export interface SyncConfig extends SupabaseConnection {
  email: string;
  session: SupabaseSession;
  /** null = baja todo (celular del dueño); con valor = el catálogo y sólo esa sucursal (PC del local). */
  scope_store_id: string | null;
}

export const getSyncConfig = () => getMeta<SyncConfig>(KEY);

/** Vincular empieza de cero la descarga, porque cambia lo que le corresponde a este dispositivo. */
export async function saveSyncConfig(config: SyncConfig): Promise<void> {
  await db.transaction('rw', db.meta, async () => {
    await setMeta(KEY, config);
    await setMeta(CURSOR_KEY, 0);
  });
}

export async function updateSession(session: SupabaseSession): Promise<void> {
  const config = await getSyncConfig();
  if (config) await setMeta(KEY, { ...config, session });
}

/** Desvincula sin borrar nada: los datos y los cambios pendientes quedan en el dispositivo. */
export async function clearSyncConfig(): Promise<void> {
  await db.meta.bulkDelete([KEY, CURSOR_KEY]);
}

/**
 * Deja sólo caracteres visibles comunes. Al copiar desde WhatsApp u otras apps viajan caracteres invisibles
 * (marcas de dirección de texto, espacios de ancho cero) que el navegador rechaza al enviar la clave.
 */
export function cleanCredential(raw: string): string {
  return raw.replace(/[^\x21-\x7E]/g, '');
}

/**
 * Tipear la dirección en el celular es fácil de errar: se completan "https://", se pasa "http://" a "https://"
 * (una página segura no puede conectarse a una que no lo es) y se quitan espacios y barras finales.
 * Devuelve null si no parece una dirección.
 */
export function normalizeProjectUrl(raw: string): string | null {
  let text = cleanCredential(raw).replace(/\/+$/, '');
  if (!text) return null;
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    // "supabase.co." con punto final: Chrome lo tolera, pero Safari en iPhone no puede conectarse.
    url.hostname = url.hostname.replace(/\.+$/, '');
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (!local && url.protocol === 'http:') url.protocol = 'https:';
    if (!url.hostname.includes('.') && !local) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Código para no tipear la dirección y la clave en el celular. La clave anónima no da acceso sin iniciar sesión. */
export function encodeLinkCode(conn: SupabaseConnection): string {
  return btoa(JSON.stringify({ url: normalizeProjectUrl(conn.url) ?? conn.url, anon_key: cleanCredential(conn.anon_key) }));
}

export function decodeLinkCode(code: string): SupabaseConnection | null {
  try {
    const parsed = JSON.parse(atob(cleanCredential(code))) as Partial<SupabaseConnection>;
    return parsed.url && parsed.anon_key ? { url: cleanCredential(parsed.url), anon_key: cleanCredential(parsed.anon_key) } : null;
  } catch {
    return null;
  }
}
