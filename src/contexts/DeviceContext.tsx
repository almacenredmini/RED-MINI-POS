import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Logo } from '@/components/ui/Logo';
import { getCurrentStoreId, getDeviceId, setCurrentStoreId } from '@/database/meta';
import { listStores } from '@/database/repositories/stores';
import { seedIfEmpty } from '@/database/seed';
import { requestPersistentStorage } from '@/services/storage';
import type { Store } from '@/types/domain';

interface DeviceState {
  deviceId: string;
  stores: Store[];
  currentStore: Store | null;
  selectStore: (id: string) => Promise<void>;
}

const DeviceContext = createContext<DeviceState | null>(null);

/** Identidad del dispositivo y sucursal en la que opera. Todo lo que se registre queda asociado a ambos. */
export function DeviceProvider({ children }: { children: ReactNode }) {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [storeId, setStoreId] = useState<string | null | undefined>(undefined);
  const stores = useLiveQuery(listStores, []);

  useEffect(() => {
    (async () => {
      await seedIfEmpty();
      void requestPersistentStorage();
      setDeviceId(await getDeviceId());
      setStoreId((await getCurrentStoreId()) ?? null);
    })();
  }, []);

  const selectStore = useCallback(async (id: string) => {
    await setCurrentStoreId(id);
    setStoreId(id);
  }, []);

  const value = useMemo<DeviceState | null>(() => {
    if (!deviceId || !stores || storeId === undefined) return null;
    return { deviceId, stores, currentStore: stores.find((s) => s.id === storeId) ?? null, selectStore };
  }, [deviceId, stores, storeId, selectStore]);

  if (!value) return <div className="boot"><Logo /></div>;
  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
}

export function useDevice(): DeviceState {
  const ctx = useContext(DeviceContext);
  if (!ctx) throw new Error('useDevice debe usarse dentro de <DeviceProvider>');
  return ctx;
}

/** Para pantallas que requieren sucursal; el layout garantiza que exista antes de renderizarlas. */
export function useCurrentStore(): Store {
  const { currentStore } = useDevice();
  if (!currentStore) throw new Error('No hay sucursal seleccionada');
  return currentStore;
}
