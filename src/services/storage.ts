/**
 * Pide al navegador almacenamiento persistente: sin esto, Chrome/Safari pueden borrar
 * IndexedDB si el disco se llena, y con eso ventas no sincronizadas.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

export async function getStorageEstimate(): Promise<{ usage: number; quota: number; persisted: boolean } | null> {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  const persisted = (await navigator.storage.persisted?.()) ?? false;
  return { usage, quota, persisted };
}
