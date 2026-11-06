import { SyncAuthError, SyncNetworkError, type PullPage, type PushOp, type PushResult, type SyncTransport } from './transport';

export interface SupabaseSession {
  access_token: string;
  refresh_token: string;
}

export interface SupabaseConnection {
  url: string;
  anon_key: string;
}

/** Con `fetch` directo y sin el SDK: son tres llamadas y así el proveedor queda fácil de reemplazar. */
async function request(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new SyncNetworkError('Sin conexión con el servidor');
  }
}

async function authRequest(conn: SupabaseConnection, grant: string, body: object): Promise<SupabaseSession> {
  const res = await request(`${conn.url}/auth/v1/token?grant_type=${grant}`, {
    method: 'POST',
    headers: { apikey: conn.anon_key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status >= 500) throw new SyncNetworkError('El servidor no está disponible');
  if (!res.ok) throw new SyncAuthError(grant === 'password' ? 'Correo o contraseña incorrectos' : 'La sesión venció: volvé a vincular este dispositivo');
  const { access_token, refresh_token } = (await res.json()) as SupabaseSession;
  return { access_token, refresh_token };
}

export function signIn(conn: SupabaseConnection, email: string, password: string): Promise<SupabaseSession> {
  return authRequest(conn, 'password', { email, password });
}

export function createSupabaseTransport(conn: SupabaseConnection, initial: SupabaseSession, onSession: (s: SupabaseSession) => Promise<void>): SyncTransport {
  let session = initial;

  const post = (fn: string, body: object) =>
    request(`${conn.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: conn.anon_key, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const rpc = async <T>(fn: string, body: object): Promise<T> => {
    let res = await post(fn, body);
    if (res.status === 401) {
      session = await authRequest(conn, 'refresh_token', { refresh_token: session.refresh_token });
      await onSession(session);
      res = await post(fn, body);
    }
    if (res.status === 401 || res.status === 403) throw new SyncAuthError('Este correo no está autorizado a sincronizar');
    if (!res.ok) throw new SyncNetworkError(`El servidor respondió ${res.status}`);
    return (await res.json()) as T;
  };

  return {
    push: (deviceId: string, ops: PushOp[]) => rpc<PushResult[]>('sync_push', { p_device: deviceId, p_ops: ops }),
    pull: (cursor: number, storeId: string | null, limit: number) => rpc<PullPage>('sync_pull', { p_cursor: cursor, p_store: storeId, p_limit: limit }),
  };
}
