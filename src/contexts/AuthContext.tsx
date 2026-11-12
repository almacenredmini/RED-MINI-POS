import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useDevice } from '@/contexts/DeviceContext';
import { db } from '@/database/db';
import { authenticate } from '@/database/repositories/users';
import { getOpenSession } from '@/database/repositories/cash';
import { seedAdminIfEmpty } from '@/database/seed';
import { hasPermission, type PermissionKey } from '@/services/permissions';
import { getSyncConfig } from '@/services/sync/config';
import type { User } from '@/types/domain';
import { START_ROUTE } from '@/startOnPos';

interface AuthState {
  user: User | null;
  /** Se está recuperando la sesión que quedó abierta en este dispositivo. */
  restoring: boolean;
  /** El navegador no ofrece WebCrypto: la app se abrió por HTTP y no se puede validar contraseñas. */
  insecure: boolean;
  /** null si entró; si no, el motivo para mostrar. */
  login: (username: string, password: string) => Promise<string | null>;
  logout: () => void;
  can: (key: PermissionKey) => boolean;
  canSwitchStore: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

const SESSION_KEY = 'redmini.session';

/** Guarda sólo el id del usuario: la contraseña nunca queda en el dispositivo. */
function readSession(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function writeSession(userId: string | null) {
  try {
    if (userId) localStorage.setItem(SESSION_KEY, userId);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Sin almacenamiento la sesión dura hasta recargar, como antes.
  }
}

/**
 * La sesión queda abierta en este dispositivo hasta que el usuario toca "Salir",
 * aunque se recargue la página o se cierre el navegador.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(readSession);
  const [user, setUser] = useState<User | null>(null);
  const [insecure, setInsecure] = useState(false);
  const { stores, currentStore, selectStore } = useDevice();

  useEffect(() => {
    seedAdminIfEmpty().catch(() => setInsecure(true));
  }, []);

  // Si otro usuario le cambia los permisos o lo desactiva, se aplica al instante.
  // null = el usuario ya no existe; undefined = todavía se está leyendo.
  const live = useLiveQuery(async () => (userId ? ((await db.users.get(userId)) ?? null) : undefined), [userId]);
  useEffect(() => {
    if (live === undefined) return;
    if (live?.active) {
      setUser(live);
    } else {
      writeSession(null);
      setUserId(null);
      setUser(null);
    }
  }, [live]);
  const restoring = userId !== null && user === null;

  // Un usuario con sucursal fija siempre trabaja en esa, sin importar qué dejó elegido el anterior.
  const scopeStore = useLiveQuery(async () => (await getSyncConfig())?.scope_store_id ?? null, [], null);
  const fixedStore = user?.store_id ?? scopeStore;
  useEffect(() => {
    if (fixedStore && fixedStore !== currentStore?.id && stores.some((s) => s.id === fixedStore)) void selectStore(fixedStore);
  }, [fixedStore, currentStore?.id, stores, selectStore]);

  const login = useCallback(async (username: string, password: string) => {
    const found = await authenticate(username, password);
    if (!found) return 'Usuario o contraseña incorrectos';
    // Con la caja de otro cajero abierta sólo puede entrar quien administra cajas (el dueño):
    // el cajero que llega tiene que esperar a que el anterior cuente y toque "Salir".
    const open = await getOpenSession();
    if (open && open.opened_by !== found.id && !hasPermission(found, 'cash.manage')) {
      const holder = open.opened_by ? (await db.users.get(open.opened_by))?.name : undefined;
      return `La caja de ${holder ?? 'otro usuario'} está abierta en este dispositivo. Tiene que entrar y tocar "Salir" para cerrarla, o pedile al dueño que la cierre.`;
    }
    writeSession(found.id);
    // Quien entra (también después de "Cambiar usuario") empieza en Vender.
    window.location.hash = START_ROUTE;
    setUserId(found.id);
    setUser(found);
    return null;
  }, []);

  const logout = useCallback(() => {
    writeSession(null);
    setUserId(null);
    setUser(null);
  }, []);

  const can = useCallback((key: PermissionKey) => (user ? hasPermission(user, key) : false), [user]);

  const canSwitchStore = user !== null && user.store_id === null && user.role !== 'employee' && scopeStore === null;
  const value = useMemo(() => ({ user, restoring, insecure, login, logout, can, canSwitchStore }), [user, restoring, insecure, login, logout, can, canSwitchStore]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
