import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeLinkCode, encodeLinkCode, normalizeProjectUrl } from './config';
import { createSupabaseTransport, signIn } from './supabase';
import { SyncAuthError, SyncNetworkError } from './transport';

const conn = { url: 'https://x.supabase.co', anon_key: 'anon' };
const session = { access_token: 'viejo', refresh_token: 'r1' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe('conexión con Supabase', () => {
  it('inicia sesión con la dirección y la clave correctas', async () => {
    const fetchMock = vi.fn(async () => json(200, { access_token: 'a', refresh_token: 'b', extra: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await signIn(conn, 'a@b.c', 'x')).toEqual({ access_token: 'a', refresh_token: 'b' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://x.supabase.co/auth/v1/token?grant_type=password');
    expect((init.headers as Record<string, string>).apikey).toBe('anon');
  });

  it('informa credenciales incorrectas y servidor caído como cosas distintas', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(400, {})));
    await expect(signIn(conn, 'a', 'b')).rejects.toBeInstanceOf(SyncAuthError);
    vi.stubGlobal('fetch', vi.fn(async () => json(503, {})));
    await expect(signIn(conn, 'a', 'b')).rejects.toBeInstanceOf(SyncNetworkError);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('failed'); }));
    await expect(signIn(conn, 'a', 'b')).rejects.toBeInstanceOf(SyncNetworkError);
  });

  it('explica el motivo cuando Supabase rechaza el ingreso', async () => {
    const reason = async (status: number, body: object) => {
      vi.stubGlobal('fetch', vi.fn(async () => json(status, body)));
      return signIn(conn, 'a', 'b').catch((e: Error) => e.message);
    };
    expect(await reason(400, { error_code: 'invalid_credentials' })).toContain('Correo o contraseña incorrectos');
    expect(await reason(400, { error_code: 'email_not_confirmed' })).toContain('Auto Confirm User');
    expect(await reason(422, { error_code: 'email_provider_disabled' })).toContain('habilitá Email');
    expect(await reason(401, { message: 'Invalid API key' })).toContain('Publishable key');
    expect(await reason(400, { msg: 'Algo raro' })).toContain('Algo raro');
  });

  it('si la sesión venció la renueva, la guarda y reintenta', async () => {
    const onSession = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/auth/v1/token')) return json(200, { access_token: 'nuevo', refresh_token: 'r2' });
      return (init.headers as Record<string, string>).Authorization === 'Bearer nuevo' ? json(200, { changes: [], next_cursor: 0, has_more: false }) : json(401, {});
    });
    vi.stubGlobal('fetch', fetchMock);

    const page = await createSupabaseTransport(conn, session, onSession).pull(0, null, 10);
    expect(page.has_more).toBe(false);
    expect(onSession).toHaveBeenCalledWith({ access_token: 'nuevo', refresh_token: 'r2' });
  });

  it('un correo no autorizado o una renovación fallida piden volver a vincular', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(403, {})));
    await expect(createSupabaseTransport(conn, session, vi.fn()).pull(0, null, 1)).rejects.toBeInstanceOf(SyncAuthError);
    vi.stubGlobal('fetch', vi.fn(async () => json(401, {})));
    await expect(createSupabaseTransport(conn, session, vi.fn()).pull(0, null, 1)).rejects.toBeInstanceOf(SyncAuthError);
  });

  it('un error del servidor se reintenta y no pide vincular', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(500, {})));
    await expect(createSupabaseTransport(conn, session, vi.fn()).push('d', [])).rejects.toBeInstanceOf(SyncNetworkError);
  });

  it('corrige los errores comunes al tipear la dirección en el celular', () => {
    expect(normalizeProjectUrl('pwqy.supabase.co')).toBe('https://pwqy.supabase.co');
    expect(normalizeProjectUrl(' http://pwqy.supabase.co/ ')).toBe('https://pwqy.supabase.co');
    expect(normalizeProjectUrl('https://pwqy.supabase.co/rest/v1/')).toBe('https://pwqy.supabase.co');
    expect(normalizeProjectUrl('https://pwqy. supabase.co')).toBe('https://pwqy.supabase.co');
    expect(normalizeProjectUrl('http://localhost:54399')).toBe('http://localhost:54399');
    expect(normalizeProjectUrl('cualquiera')).toBeNull();
    expect(normalizeProjectUrl('')).toBeNull();
  });

  it('acepta el código aunque WhatsApp le agregue espacios o saltos de línea', () => {
    const code = encodeLinkCode(conn);
    expect(decodeLinkCode(`${code.slice(0, 10)}\n ${code.slice(10)} `)).toEqual(conn);
  });

  it('si no hay conexión, dice a qué dirección intentó conectarse', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('failed'); }));
    await expect(signIn(conn, 'a', 'b')).rejects.toThrow('x.supabase.co');
  });

  it('el código de vinculación lleva la dirección y la clave, nunca la sesión', () => {
    const code = encodeLinkCode({ ...conn, email: 'a@b.c', session } as typeof conn);
    expect(decodeLinkCode(code)).toEqual(conn);
    expect(atob(code)).not.toContain('r1');
    expect(decodeLinkCode('no es un código')).toBeNull();
  });
});
