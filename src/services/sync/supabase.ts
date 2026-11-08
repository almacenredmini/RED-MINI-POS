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

/** Supabase responde con distintos códigos; "contraseña incorrecta" para todo hace imposible saber qué corregir. */
async function authErrorMessage(res: Response, grant: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error_code?: string; msg?: string; message?: string; error_description?: string };
  const code = data.error_code ?? '';
  if (code === 'invalid_credentials') return 'Correo o contraseña incorrectos. Usá la contraseña del usuario creado en Supabase, no la de admin.';
  if (code === 'email_not_confirmed') return 'El usuario no está confirmado. En Supabase, crealo de nuevo marcando Auto Confirm User.';
  if (code === 'email_provider_disabled') return 'El inicio de sesión por correo está desactivado. En Supabase, Sign In / Providers, habilitá Email.';
  if (res.status === 401 || /api key/i.test(data.message ?? '')) return 'La clave pública no es válida. Copiá de nuevo la Publishable key.';
  if (grant !== 'password') return 'La sesión venció: volvé a vincular este dispositivo';
  const detail = data.msg ?? data.error_description ?? data.message;
  return detail ? `Supabase rechazó el ingreso: ${detail}` : `Supabase rechazó el ingreso (código ${res.status})`;
}

async function authRequest(conn: SupabaseConnection, grant: string, body: object): Promise<SupabaseSession> {
  const res = await request(`${conn.url}/auth/v1/token?grant_type=${grant}`, {
    method: 'POST',
    headers: { apikey: conn.anon_key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status >= 500) throw new SyncNetworkError('El servidor no está disponible');
  if (!res.ok) throw new SyncAuthError(await authErrorMessage(res, grant));
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
