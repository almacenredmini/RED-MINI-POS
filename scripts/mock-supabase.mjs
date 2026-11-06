// Imita a Supabase en la PC para probar la sincronización sin una cuenta: PostgreSQL real (PGlite),
// las mismas migraciones y las mismas direcciones HTTP. Los datos viven en memoria y se pierden al cerrar.
// Uso: npm run supabase:mock → dirección http://localhost:54399, clave "mock", correo dueno@redmini.test, contraseña "prueba".
import { createServer } from 'node:http';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

const PORT = 54399;
const EMAIL = 'dueno@redmini.test';
const PASSWORD = 'prueba';
const ACCESS = 'mock-access';
const REFRESH = 'mock-refresh';

const pg = new PGlite({ extensions: { pg_trgm } });
await pg.exec(`
  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema auth, public to anon, authenticated;
  grant execute on function auth.jwt() to anon, authenticated;
`);
const dir = 'supabase/migrations';
for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pg.exec(readFileSync(join(dir, f), 'utf8'));
await pg.query('insert into sync_members (email) values ($1)', [EMAIL]);

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const send = (res, status, body) => {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const CALLS = {
  sync_push: { sql: 'select sync_push($1::uuid, $2::jsonb) as r', params: (b) => [b.p_device, b.p_ops] },
  sync_pull: { sql: 'select sync_pull($1::bigint, $2::uuid, $3::int) as r', params: (b) => [b.p_cursor, b.p_store, b.p_limit] },
};

createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', async () => {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const body = raw ? JSON.parse(raw) : {};

    if (url.pathname === '/auth/v1/token') {
      const ok = url.searchParams.get('grant_type') === 'password' ? body.email === EMAIL && body.password === PASSWORD : body.refresh_token === REFRESH;
      return ok ? send(res, 200, { access_token: ACCESS, refresh_token: REFRESH }) : send(res, 400, { error: 'invalid_grant' });
    }

    const call = CALLS[url.pathname.replace('/rest/v1/rpc/', '')];
    if (!call) return send(res, 404, {});
    if (req.headers.authorization !== `Bearer ${ACCESS}`) return send(res, 401, {});

    try {
      await pg.exec(`set request.jwt.claims = '${JSON.stringify({ email: EMAIL })}'; set role authenticated;`);
      const result = await pg.query(call.sql, call.params(body));
      send(res, 200, result.rows[0].r);
    } catch (e) {
      console.error(e.message);
      send(res, 400, { message: e.message });
    } finally {
      await pg.exec('reset role;');
    }
  });
}).listen(PORT, () => console.log(`Supabase simulado en http://localhost:${PORT}`));
