import { db } from './db';
import { uuidv7 } from '@/services/id';

const DEVICE_ID = 'device_id';
const CURRENT_STORE = 'current_store_id';

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await db.meta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

/** Identificador estable del dispositivo. Se crea una sola vez y viaja en cada cambio sincronizado. */
export async function getDeviceId(): Promise<string> {
  return db.transaction('rw', db.meta, async () => {
    const existing = await getMeta<string>(DEVICE_ID);
    if (existing) return existing;
    const id = uuidv7();
    await setMeta(DEVICE_ID, id);
    return id;
  });
}

export const getCurrentStoreId = () => getMeta<string>(CURRENT_STORE);
export const setCurrentStoreId = (id: string) => setMeta(CURRENT_STORE, id);

/** Sólo lectura (sirve dentro de useLiveQuery). undefined si el dispositivo todavía no tiene id. */
export const peekDeviceId = () => getMeta<string>(DEVICE_ID);
