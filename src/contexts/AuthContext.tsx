import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useDevice } from '@/contexts/DeviceContext';
import { db } from '@/database/db';
import { authenticate } from '@/database/repositories/users';
import { seedAdminIfEmpty } from '@/database/seed';
import { hasPermission, type PermissionKey } from '@/services/permissions';
import { getSyncConfig } from '@/services/sync/config';
import type { User } from '@/types/domain';

interface AuthState {
  user: User | null;
  /** El navegador no ofrece WebCrypto: la app se abrió por HTTP y no se puede validar contraseñas. */
  insecure: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  can: (key: PermissionKey) => boolean;
  canSwitchStore: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * La sesión vive sólo en memoria: cada vez que se carga la página se vuelve a pedir usuario.
 * Lo que no se perdió por eso (el carrito en curso) está guardado aparte en la base local.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [insecure, setInsecure] = useState(false);
  const { stores, currentStore, selectStore } = useDevice();

  useEffect(() => {
    seedAdminIfEmpty().catch(() => setInsecure(true));
  }, []);

  // Si otro usuario le cambia los permisos o lo desactiva, se aplica al instante.
  const live = useLiveQuery(() => (userId ? db.users.get(userId) : undefined), [userId]);
  useEffect(() => {
    if (!live) return;
    if (live.active) {
      setUser(live);
    } else {
      setUserId(null);
      setUser(null);
    }
  }, [live]);

  // Un usuario con sucursal fija siempre trabaja en esa, sin importar qué dejó elegido el anterior.
  const scopeStore = useLiveQuery(async () => (await getSyncConfig())?.scope_store_id ?? null, [], null);
  const fixedStore = user?.store_id ?? scopeStore;
  useEffect(() => {
    if (fixedStore && fixedStore !== currentStore?.id && stores.some((s) => s.id === fixedStore)) void selectStore(fixedStore);
  }, [fixedStore, currentStore?.id, stores, selectStore]);

  const login = useCallback(async (username: string, password: string) => {
    const found = await authenticate(username, password);
    if (found) {
      setUserId(found.id);
      setUser(found);
    }
    return found !== null;
  }, []);

  const logout = useCallback(() => {
    setUserId(null);
    setUser(null);
  }, []);

  const can = useCallback((key: PermissionKey) => (user ? hasPermission(user, key) : false), [user]);

  const canSwitchStore = user !== null && user.store_id === null && user.role !== 'employee' && scopeStore === null;
  const value = useMemo(() => ({ user, insecure, login, logout, can, canSwitchStore }), [user, insecure, login, logout, can, canSwitchStore]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
