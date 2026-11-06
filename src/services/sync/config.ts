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

/** Código para no tipear la dirección y la clave en el celular. La clave anónima no da acceso sin iniciar sesión. */
export function encodeLinkCode(conn: SupabaseConnection): string {
  return btoa(JSON.stringify({ url: conn.url, anon_key: conn.anon_key }));
}

export function decodeLinkCode(code: string): SupabaseConnection | null {
  try {
    const parsed = JSON.parse(atob(code.trim())) as Partial<SupabaseConnection>;
    return parsed.url && parsed.anon_key ? { url: parsed.url, anon_key: parsed.anon_key } : null;
  } catch {
    return null;
  }
}
