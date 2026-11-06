import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/database/db';
import { getDeviceId, setMeta } from '@/database/meta';
import { listAccounts, saveAccount } from '@/database/repositories/accounts';
import { registerManualMovement } from '@/database/repositories/inventory';
import { findProductByBarcode, saveProduct, type ProductInput } from '@/database/repositories/products';
import { cancelPurchase, savePurchase } from '@/database/repositories/purchases';
import { createSale, voidSale } from '@/database/repositories/sales';
import { seedAdminIfEmpty, seedIfEmpty } from '@/database/seed';
import { addLine, changeQuantity, cartTotals, EMPTY_CART } from '@/services/cart';
import { uuidv7 } from '@/services/id';
import { computePayment } from '@/services/payment';
import { CURSOR_KEY } from './config';
import { requeueErrors, syncWith } from './engine';
import { SyncAuthError, type PullPage, type PushOp, type PushResult, type SyncTransport } from './transport';

const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const ORO = { id: '01930000-0000-7000-8000-000000000001', code: 'ORO' };
const URI = { id: '01930000-0000-7000-8000-000000000002', code: 'URI' };
const MEMBER = 'dueno@redmini.test';

let pg: PGlite;

/** Lo mismo que hace Supabase: cada llamada corre con el rol y el token del que la hace. */
async function asRole<T>(role: 'authenticated' | 'anon', email: string | null, sql: string, params: unknown[]): Promise<T> {
  const claims = email ? JSON.stringify({ email }).replace(/'/g, "''") : '';
  await pg.exec(`set request.jwt.claims = '${claims}'; set role ${role};`);
  try {
    const res = await pg.query<{ r: T }>(sql, params);
    return res.rows[0]!.r;
  } finally {
    await pg.exec('reset role;');
  }
}

const transport: SyncTransport = {
  push: (deviceId: string, ops: PushOp[]) => asRole<PushResult[]>('authenticated', MEMBER, 'select sync_push($1::uuid, $2::jsonb) as r', [deviceId, ops]),
  pull: (cursor: number, storeId: string | null, limit: number) => asRole<PullPage>('authenticated', MEMBER, 'select sync_pull($1::bigint, $2::uuid, $3::int) as r', [cursor, storeId, limit]),
};

async function resetServer() {
  pg = new PGlite({ extensions: { pg_trgm } });
  await pg.exec(`
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create role anon nologin;
    create role authenticated nologin;
    grant usage on schema auth, public to anon, authenticated;
    grant execute on function auth.jwt() to anon, authenticated;
  `);
  for (const file of Object.keys(MIGRATIONS).sort()) await pg.exec(MIGRATIONS[file]!);
  await pg.query('insert into sync_members (email) values ($1)', [MEMBER]);
}

/** Cada "dispositivo" es una copia guardada de toda la base local, que se restaura para simularlo. */
async function saveDevice(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const t of db.tables) out[t.name] = await t.toArray();
  return out;
}

async function loadDevice(snapshot: Record<string, unknown[]>) {
  await db.delete();
  await db.open();
  for (const t of db.tables) await t.bulkPut(snapshot[t.name] ?? []);
}

async function newDevice() {
  await db.delete();
  await db.open();
  await seedIfEmpty();
  await seedAdminIfEmpty();
}

const sync = (storeId: string | null = null) => syncWith(transport, storeId);

const base: ProductInput = { name: 'Fernet', brand: null, sku: null, category_id: null, unit: 'unit', cost_cents: 1000, price_cents: 2000, min_stock: 0, auto_min_stock: true, active: true, barcodes: ['111'] };

async function sell(productId: string, qty: number, store: { id: string; code: string }) {
  const cart = changeQuantity(addLine(EMPTY_CART, { product_id: productId, name: 'Fernet', barcode: '111', unit: 'unit', unit_price_cents: 2000, unit_cost_cents: 1000 }), productId, qty - 1);
  return createSale({ id: uuidv7(), store, userId: null, cart, payments: computePayment('cash', cartTotals(cart).total, null).payments });
}

const localStock = async (storeId: string, productId: string) => (await db.stock.get(`${storeId}:${productId}`))?.quantity ?? 0;
const serverStock = async (storeId: string, productId: string) => {
  const res = await pg.query<{ quantity: string }>('select quantity from stock where store_id = $1 and product_id = $2', [storeId, productId]);
  return Number(res.rows[0]?.quantity ?? 0);
};
const queueByStatus = async (status: string) => db.sync_queue.where('status').equals(status).count();

beforeAll(async () => {
  await resetServer();
}, 120_000);

beforeEach(async () => {
  await resetServer();
  await newDevice();
}, 120_000);

describe('migraciones', () => {
  it('se ejecutan todas en PostgreSQL y crean las tablas', async () => {
    const res = await pg.query<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public'");
    const names = res.rows.map((r) => r.tablename);
    for (const t of ['stores', 'users', 'products', 'barcodes', 'stock', 'stock_movements', 'sales', 'sale_items', 'payments', 'purchases', 'suppliers', 'sync_queue', 'employee_accounts', 'account_movements']) {
      expect(names).toContain(t);
    }
  });

  it('todas las tablas tienen RLS activado', async () => {
    const res = await pg.query<{ relname: string }>("select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity");
    expect(res.rows).toEqual([]);
  });

  it('el servidor impide cambiar stock o movimientos a mano', async () => {
    await newDevice();
    await sync();
    const p = await saveProduct(base);
    await registerManualMovement({ kind: 'entry', storeId: ORO.id, product: p, quantity: 5, reason: '', userId: null });
    await sync();
    await expect(pg.exec('delete from stock_movements')).rejects.toThrow('append-only');
    await expect(pg.exec('update stock_movements set quantity = 100')).rejects.toThrow('append-only');
  });
});

describe('acceso', () => {
  it('sin sesión no se puede llamar nada ni leer tablas', async () => {
    await expect(asRole('anon', null, 'select sync_pull(0) as r', [])).rejects.toThrow('permission denied');
    await expect(asRole('anon', null, "select count(*) as r from users", [])).rejects.toThrow('permission denied');
  });

  it('con sesión tampoco se pueden leer las tablas directamente', async () => {
    await expect(asRole('authenticated', MEMBER, 'select count(*) as r from users', [])).rejects.toThrow('permission denied');
    await expect(asRole('authenticated', MEMBER, 'select sync_apply_op($1, $2, $3::uuid, $4::jsonb) as r', ['products', 'upsert', uuidv7(), {}])).rejects.toThrow('permission denied');
  });

  it('un correo no autorizado no puede sincronizar aunque tenga cuenta', async () => {
    await expect(asRole('authenticated', 'otro@mail.test', 'select sync_pull(0) as r', [])).rejects.toThrow('no está autorizado');
    await expect(asRole('authenticated', 'otro@mail.test', 'select sync_push($1::uuid, $2::jsonb) as r', [uuidv7(), []])).rejects.toThrow('no está autorizado');
  });
});

describe('sincronización entre dispositivos', () => {
  it('una venta llega al servidor con todo y deja la cola vacía', async () => {
    const p = await saveProduct(base);
    await registerManualMovement({ kind: 'entry', storeId: ORO.id, product: p, quantity: 10, reason: '', userId: null });
    const { sale } = await sell(p.id, 3, ORO);
    await sync();

    expect(await db.sync_queue.count()).toBe(0);
    expect(await serverStock(ORO.id, p.id)).toBe(7);
    const res = await pg.query<{ total_cents: string; number: string }>('select total_cents, number from sales where id = $1', [sale.id]);
    expect(Number(res.rows[0]?.total_cents)).toBe(6000);
    expect((await pg.query('select * from sale_items where sale_id = $1', [sale.id])).rows).toHaveLength(1);
    expect((await pg.query('select * from payments where sale_id = $1', [sale.id])).rows).toHaveLength(1);
  });

  it('un dispositivo nuevo recibe catálogo, stock y ventas, con fechas en el formato local', async () => {
    const p = await saveProduct(base);
    await registerManualMovement({ kind: 'entry', storeId: ORO.id, product: p, quantity: 10, reason: '', userId: null });
    const { sale } = await sell(p.id, 2, ORO);
    await sync();

    await newDevice();
    await sync();
    expect((await findProductByBarcode('111'))?.name).toBe('Fernet');
    expect(await localStock(ORO.id, p.id)).toBe(8);
    const local = await db.sales.get(sale.id);
    expect(local?.occurred_at).toMatch(/Z$/);
    expect(await db.sale_items.where('sale_id').equals(sale.id).count()).toBe(1);
    // La búsqueda funciona aunque el índice de palabras no viaje al servidor.
    expect((await db.products.get(p.id))?.search_words).toContain('fernet');
    expect(await db.sync_queue.count()).toBe(0);
  });

  it('dos dispositivos vendiendo sin Internet suman sus ventas sin pisarse', async () => {
    const p = await saveProduct(base);
    await registerManualMovement({ kind: 'entry', storeId: ORO.id, product: p, quantity: 10, reason: '', userId: null });
    await sync();
    const pc = await saveDevice();

    await newDevice();
    await sync();
    await sell(p.id, 2, ORO);
    const phone = await saveDevice();

    await loadDevice(pc);
    await sell(p.id, 3, ORO);
    await sync();

    await loadDevice(phone);
    await sync();
    expect(await localStock(ORO.id, p.id)).toBe(5);
    expect(await serverStock(ORO.id, p.id)).toBe(5);

    await loadDevice(await saveDevice());
    await sync();
    expect(await db.sales.count()).toBe(2);
  });

  it('la mercadería cargada desde el celular suma en la PC', async () => {
    const p = await saveProduct(base);
    await sync();
    const pc = await saveDevice();

    await newDevice();
    await sync();
    const phoneProduct = (await db.products.get(p.id))!;
    await registerManualMovement({ kind: 'entry', storeId: ORO.id, product: phoneProduct, quantity: 24, reason: 'Carga desde Escanear', userId: null });
    await sync();

    await loadDevice(pc);
    await sell(p.id, 1, ORO);
    await sync();
    expect(await localStock(ORO.id, p.id)).toBe(23);
  });

  it('un producto creado en el celular aparece en la PC', async () => {
    await sync();
    const pc = await saveDevice();

    await newDevice();
    await sync();
    const p = await saveProduct({ ...base, name: 'Nuevo', barcodes: ['999'] });
    await sync();

    await loadDevice(pc);
    await sync();
    expect((await findProductByBarcode('999'))?.id).toBe(p.id);
  });

  it('reenviar lo mismo no duplica nada', async () => {
    const p = await saveProduct(base);
    await registerManualMovement({ kind: 'entry', storeId: ORO.id, product: p, quantity: 4, reason: '', userId: null });
    const queued = (await db.sync_queue.toArray()).map(({ id, table, record_id, op, payload, created_at }) => ({ id, table, record_id, op, payload, created_at }));
    const deviceId = await getDeviceId();

    await transport.push(deviceId, queued);
    const second = await transport.push(deviceId, queued);
    expect(second.every((r) => r.result === 'duplicate')).toBe(true);
    expect(await serverStock(ORO.id, p.id)).toBe(4);
  });

  it('si se corta mientras sube, el próximo intento completa sin duplicar', async () => {
    const p = await saveProduct(base);
    await registerManualMovement({ kind: 'entry', storeId: ORO.id, product: p, quantity: 4, reason: '', userId: null });
    const flaky: SyncTransport = {
      push: async (d, ops) => {
        await transport.push(d, ops);
        throw new Error('corte de red después de aplicar');
      },
      pull: transport.pull,
    };
    await expect(syncWith(flaky, null)).rejects.toThrow('corte');
    expect(await queueByStatus('in_flight')).toBeGreaterThan(0);

    await sync();
    expect(await db.sync_queue.count()).toBe(0);
    expect(await serverStock(ORO.id, p.id)).toBe(4);
  });

  it('un cambio hecho mientras se sube no se pierde', async () => {
    const p = await saveProduct(base);
    let edited = false;
    const slow: SyncTransport = {
      push: async (d, ops) => {
        if (!edited) await saveProduct({ ...base, price_cents: 5000 }, p.id);
        edited = true;
        return transport.push(d, ops);
      },
      pull: transport.pull,
    };
    await syncWith(slow, null);
    await sync();
    const res = await pg.query<{ price_cents: string }>('select price_cents from products where id = $1', [p.id]);
    expect(Number(res.rows[0]?.price_cents)).toBe(5000);
  });

  it('sin autorización los cambios quedan guardados en el dispositivo', async () => {
    const p = await saveProduct(base);
    const denied: SyncTransport = {
      push: async () => {
        throw new SyncAuthError('no autorizado');
      },
      pull: transport.pull,
    };
    await expect(syncWith(denied, null)).rejects.toBeInstanceOf(SyncAuthError);
    expect(await db.products.get(p.id)).toBeDefined();
    await sync();
    expect(await db.sync_queue.count()).toBe(0);
  });
});

describe('conflictos', () => {
  it('editar el mismo producto en dos lados: gana el último y todos terminan iguales', async () => {
    const p = await saveProduct(base);
    await sync();
    const pc = await saveDevice();

    await newDevice();
    await sync();
    const phone1 = await saveProduct({ ...base, price_cents: 3000 }, p.id);
    expect(phone1.version).toBe(2);
    const phone = await saveDevice();

    await loadDevice(pc);
    await new Promise((r) => setTimeout(r, 5));
    await saveProduct({ ...base, price_cents: 4000 }, p.id);
    await sync();

    await loadDevice(phone);
    await sync();
    expect((await db.products.get(p.id))?.price_cents).toBe(4000);
    expect(await db.sync_queue.count()).toBe(0);

    const log = await pg.query<{ result: string }>("select result from sync_queue where table_name = 'products' and record_id = $1 order by received_at desc limit 1", [p.id]);
    expect(log.rows[0]?.result).toBe('conflict_resolved');
  });

  it('un cambio local sin subir no se pisa con lo que llega', async () => {
    const p = await saveProduct(base);
    await sync();
    const original = await saveDevice();

    await saveProduct({ ...base, price_cents: 3000 }, p.id);
    await saveProduct({ ...base, price_cents: 3500 }, p.id);
    await sync();

    await loadDevice(original);
    await saveProduct({ ...base, name: 'Solo local' }, p.id);
    await setMeta(CURSOR_KEY, 0);
    const pullOnly: SyncTransport = { push: async (_d, ops) => ops.map((o) => ({ id: o.id, result: 'rejected' as const, detail: 'x' })), pull: transport.pull };
    await syncWith(pullOnly, null);
    expect((await db.products.get(p.id))?.name).toBe('Solo local');
  });

  it('un código de barras repetido entre dispositivos queda como error, sin trabar el resto ni perderse', async () => {
    await sync();
    const pc = await saveDevice();

    await newDevice();
    await sync();
    await saveProduct({ ...base, name: 'En celular', barcodes: ['555'] });
    await sync();

    await loadDevice(pc);
    const other = await saveProduct({ ...base, name: 'En PC', barcodes: ['555'] });
    await registerManualMovement({ kind: 'entry', storeId: ORO.id, product: other, quantity: 3, reason: '', userId: null });
    await sync();

    expect(await queueByStatus('error')).toBe(1);
    const failed = (await db.sync_queue.where('status').equals('error').first())!;
    expect(failed.table).toBe('barcodes');
    expect(failed.last_error).toContain('duplicate');
    expect(await serverStock(ORO.id, other.id)).toBe(3);
    expect(await db.products.count()).toBe(2);

    await requeueErrors();
    await sync();
    expect(await queueByStatus('error')).toBe(1);
  });

  it('dos dispositivos crean la misma categoría sin trabarse', async () => {
    const { ensureCategory } = await import('@/database/repositories/categories');
    await sync();
    const pc = await saveDevice();

    await newDevice();
    await sync();
    await ensureCategory('Vinos');
    await sync();

    await loadDevice(pc);
    await ensureCategory('Vinos');
    await sync();
    expect(await queueByStatus('error')).toBe(0);
  });
});

describe('alcance por sucursal', () => {
  it('la PC de un local guarda el catálogo y sólo lo suyo; el celular del dueño, todo', async () => {
    const p = await saveProduct(base);
    await registerManualMovement({ kind: 'entry', storeId: ORO.id, product: p, quantity: 10, reason: '', userId: null });
    await registerManualMovement({ kind: 'entry', storeId: URI.id, product: p, quantity: 20, reason: '', userId: null });
    await sell(p.id, 1, ORO);
    const uriSale = await sell(p.id, 2, URI);
    await sync();

    await newDevice();
    await sync(ORO.id);
    expect(await db.products.count()).toBe(1);
    expect(await localStock(ORO.id, p.id)).toBe(9);
    expect(await localStock(URI.id, p.id)).toBe(0);
    expect(await db.sales.count()).toBe(1);
    expect(await db.sales.get(uriSale.sale.id)).toBeUndefined();
    expect(await db.sale_items.where('sale_id').equals(uriSale.sale.id).count()).toBe(0);
    expect(await db.payments.where('sale_id').equals(uriSale.sale.id).count()).toBe(0);

    await newDevice();
    await sync(null);
    expect(await localStock(ORO.id, p.id)).toBe(9);
    expect(await localStock(URI.id, p.id)).toBe(18);
    expect(await db.sales.count()).toBe(2);
  });
});

describe('otras operaciones', () => {
  it('anular una venta en un dispositivo llega a los demás', async () => {
    const p = await saveProduct(base);
    const { sale } = await sell(p.id, 2, ORO);
    await sync();
    const pc = await saveDevice();

    await newDevice();
    await sync();
    await voidSale(sale.id, null, 'Error');
    await sync();

    await loadDevice(pc);
    await sync();
    expect((await db.sales.get(sale.id))?.status).toBe('voided');
    expect(await localStock(ORO.id, p.id)).toBe(0);
  });

  it('la cuenta de un empleado suma lo cargado en todos los dispositivos', async () => {
    const p = await saveProduct(base);
    const a = await saveAccount({ name: 'Juan', limit_cents: 100000, active: true });
    await sync();
    const pc = await saveDevice();
    const charge = async (qty: number) => {
      const cart = changeQuantity(addLine(EMPTY_CART, { product_id: p.id, name: 'Fernet', barcode: null, unit: 'unit', unit_price_cents: 2000, unit_cost_cents: 1000 }), p.id, qty - 1);
      await createSale({ id: uuidv7(), store: ORO, userId: null, cart, payments: computePayment('account', cartTotals(cart).total, null, a.id).payments });
    };

    await newDevice();
    await sync();
    await charge(1);
    await sync();

    await loadDevice(pc);
    await charge(2);
    await sync();
    expect((await listAccounts())[0]?.balance_cents).toBe(6000);
  });

  it('una compra recibida y una línea borrada de un borrador viajan bien', async () => {
    const p = await saveProduct(base);
    const q = await saveProduct({ ...base, name: 'Vino', barcodes: ['222'] });
    const input = { store_id: ORO.id, supplier_id: null, invoice_type: null, invoice_number: null, invoice_date: null, notes: null };
    const draft = await savePurchase({ ...input, lines: [{ product_id: p.id, quantity: 1, unit_cost_cents: 100 }, { product_id: q.id, quantity: 1, unit_cost_cents: 100 }] }, { receive: false, userId: null });
    await sync();
    const pc = await saveDevice();

    await newDevice();
    await sync();
    expect(await db.purchase_items.where('purchase_id').equals(draft.id).count()).toBe(2);
    const phone = await saveDevice();

    await loadDevice(pc);
    await savePurchase({ ...input, lines: [{ product_id: p.id, quantity: 1, unit_cost_cents: 100 }] }, { id: draft.id, receive: false, userId: null });
    await sync();

    await loadDevice(phone);
    await sync();
    expect(await db.purchase_items.where('purchase_id').equals(draft.id).count()).toBe(1);

    await cancelPurchase(draft.id);
    await sync();
    const res = await pg.query<{ status: string }>('select status from purchases where id = $1', [draft.id]);
    expect(res.rows[0]?.status).toBe('cancelled');
  });
});
