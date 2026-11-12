-- Generado con "npm run sql:bundle". No editar a mano.

-- ===== 0001_core.sql =====
-- RED MINI POS · 0001 · Núcleo: extensiones, tipos, helpers, sucursales, dispositivos, usuarios y permisos.
-- PostgreSQL 15+ estándar. Nada depende de Supabase salvo la columna opcional auth_user_id,
-- así la base se puede mover a cualquier PostgreSQL (Neon, Railway, propio) sin cambios.

create extension if not exists pg_trgm;

-- Cursor global de sincronización: cada insert/update recibe un número creciente.
-- Los dispositivos piden "todo lo que tenga server_seq > mi último". Más robusto que timestamps
-- (sin problemas de reloj ni de dos cambios en el mismo milisegundo).
create sequence if not exists sync_seq as bigint;

create or replace function tg_sync_stamp() returns trigger
language plpgsql as $$
begin
  new.server_seq := nextval('sync_seq');
  new.server_updated_at := now();
  return new;
end $$;

-- Rechaza UPDATE/DELETE en tablas append-only (ventas confirmadas, movimientos de stock).
create or replace function tg_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'La tabla % es append-only: registrá un movimiento compensatorio', tg_table_name
    using errcode = 'restrict_violation';
end $$;

-- ───────────────────────── Sucursales ─────────────────────────
create table stores (
  id                uuid primary key,
  code              text not null unique check (code ~ '^[A-Z0-9]{2,6}$'),
  name              text not null check (length(trim(name)) > 0),
  address           text,
  active            boolean not null default true,
  created_at        timestamptz not null,
  updated_at        timestamptz not null,
  deleted_at        timestamptz,
  version           integer not null default 1 check (version > 0),
  updated_by_device uuid not null,
  server_seq        bigint not null,
  server_updated_at timestamptz not null default now()
);
create index stores_server_seq_idx on stores (server_seq);
create trigger stores_sync before insert or update on stores for each row execute function tg_sync_stamp();

-- ───────────────────────── Dispositivos ─────────────────────────
-- `code` corto por sucursal: se usa en la numeración de tickets (ORO-02-000123) para que dos
-- dispositivos offline nunca generen el mismo número.
create table devices (
  id                uuid primary key,
  store_id          uuid not null references stores (id),
  code              smallint not null check (code between 1 and 99),
  name              text not null,
  platform          text,
  last_seen_at      timestamptz,
  created_at        timestamptz not null default now(),
  revoked_at        timestamptz,
  unique (store_id, code)
);
create index devices_store_idx on devices (store_id);

-- ───────────────────────── Usuarios y permisos ─────────────────────────
create type user_role as enum ('owner', 'manager', 'employee');

create table users (
  id                uuid primary key,
  auth_user_id      uuid unique,               -- Supabase Auth (opcional; login online)
  name              text not null check (length(trim(name)) > 0),
  email             text unique,
  pin_hash          text,                       -- login offline en el mostrador (PBKDF2, nunca el PIN plano)
  role              user_role not null default 'employee',
  active            boolean not null default true,
  created_at        timestamptz not null,
  updated_at        timestamptz not null,
  deleted_at        timestamptz,
  version           integer not null default 1,
  updated_by_device uuid not null,
  server_seq        bigint not null,
  server_updated_at timestamptz not null default now()
);
create index users_server_seq_idx on users (server_seq);
create trigger users_sync before insert or update on users for each row execute function tg_sync_stamp();

-- Sucursales habilitadas por usuario (el dueño ve todas implícitamente).
create table user_stores (
  user_id  uuid not null references users (id) on delete cascade,
  store_id uuid not null references stores (id) on delete cascade,
  primary key (user_id, store_id)
);
create index user_stores_store_idx on user_stores (store_id);

-- Catálogo de permisos: claves estables tipo 'sales.void', 'products.edit_price'.
create table permissions (
  key         text primary key check (key ~ '^[a-z_]+\.[a-z_]+$'),
  description text not null
);

-- Permisos por defecto del rol + excepciones por usuario ("permisos independientes").
create table role_permissions (
  role           user_role not null,
  permission_key text not null references permissions (key) on delete cascade,
  primary key (role, permission_key)
);

create table user_permissions (
  user_id        uuid not null references users (id) on delete cascade,
  permission_key text not null references permissions (key) on delete cascade,
  granted        boolean not null,             -- true = otorga, false = revoca lo que da el rol
  primary key (user_id, permission_key)
);

create or replace function user_has_permission(p_user uuid, p_key text) returns boolean
language sql stable as $$
  select coalesce(
    (select granted from user_permissions where user_id = p_user and permission_key = p_key),
    exists (
      select 1 from users u join role_permissions rp on rp.role = u.role
      where u.id = p_user and rp.permission_key = p_key and u.active
    ),
    false
  ) or exists (select 1 from users where id = p_user and role = 'owner' and active);
$$;

insert into permissions (key, description) values
  ('sales.create',        'Registrar ventas'),
  ('sales.discount',      'Aplicar descuentos'),
  ('sales.void',          'Anular ventas'),
  ('cash.open_close',     'Abrir y cerrar caja'),
  ('cash.withdraw',       'Retiros de caja'),
  ('products.view_cost',  'Ver costos y márgenes'),
  ('products.edit',       'Crear y editar productos'),
  ('products.edit_price', 'Modificar precios'),
  ('stock.adjust',        'Ajustes de inventario'),
  ('stock.transfer',      'Transferencias entre sucursales'),
  ('purchases.manage',    'Gestionar compras y proveedores'),
  ('reports.view',        'Ver reportes'),
  ('users.manage',        'Administrar usuarios');

insert into role_permissions (role, permission_key) values
  ('employee', 'sales.create'),
  ('manager', 'sales.create'), ('manager', 'sales.discount'), ('manager', 'sales.void'),
  ('manager', 'cash.open_close'), ('manager', 'cash.withdraw'), ('manager', 'products.view_cost'),
  ('manager', 'products.edit'), ('manager', 'products.edit_price'), ('manager', 'stock.adjust'),
  ('manager', 'stock.transfer'), ('manager', 'purchases.manage'), ('manager', 'reports.view');

-- Sucursales iniciales: mismos IDs que el seed local, así no se duplican al sincronizar.
insert into stores (id, code, name, created_at, updated_at, updated_by_device) values
  ('01930000-0000-7000-8000-000000000001', 'ORO', 'Oroño',   now(), now(), '00000000-0000-0000-0000-000000000000'),
  ('01930000-0000-7000-8000-000000000002', 'URI', 'Uriburu', now(), now(), '00000000-0000-0000-0000-000000000000');

-- ===== 0002_catalog.sql =====
-- RED MINI POS · 0002 · Catálogo: categorías, productos, códigos de barras, precios por sucursal.
-- Montos en centavos (bigint): sin errores de redondeo de float.

create table categories (
  id                uuid primary key,
  name              text not null check (length(trim(name)) > 0),
  parent_id         uuid references categories (id),
  created_at        timestamptz not null,
  updated_at        timestamptz not null,
  deleted_at        timestamptz,
  version           integer not null default 1,
  updated_by_device uuid not null,
  server_seq        bigint not null,
  server_updated_at timestamptz not null default now(),
  check (parent_id is distinct from id)
);
create unique index categories_name_uq on categories (lower(name)) where deleted_at is null;
create index categories_parent_idx on categories (parent_id);
create index categories_server_seq_idx on categories (server_seq);
create trigger categories_sync before insert or update on categories for each row execute function tg_sync_stamp();

create type product_unit as enum ('unit', 'kg', 'l');

create table products (
  id                uuid primary key,
  sku               text,
  name              text not null check (length(trim(name)) > 0),
  brand             text,
  category_id       uuid references categories (id),
  unit              product_unit not null default 'unit',
  cost_cents        bigint not null default 0 check (cost_cents >= 0),
  price_cents       bigint not null check (price_cents >= 0),
  min_stock         numeric(14, 3) not null default 0 check (min_stock >= 0),
  image_path        text,                       -- ruta en Storage (bucket product-images)
  active            boolean not null default true,
  created_at        timestamptz not null,
  updated_at        timestamptz not null,
  deleted_at        timestamptz,
  version           integer not null default 1,
  updated_by_device uuid not null,
  server_seq        bigint not null,
  server_updated_at timestamptz not null default now()
);
create unique index products_sku_uq on products (sku) where sku is not null and deleted_at is null;
create index products_category_idx on products (category_id);
create index products_name_trgm_idx on products using gin (name gin_trgm_ops);
create index products_brand_idx on products (brand);
create index products_server_seq_idx on products (server_seq);
create trigger products_sync before insert or update on products for each row execute function tg_sync_stamp();

-- Varios códigos por producto (unidad, pack, envase anterior, código interno).
create table barcodes (
  id                uuid primary key,
  code              text not null check (length(code) between 1 and 64),
  product_id        uuid not null references products (id),
  pack_qty          numeric(14, 3) not null default 1 check (pack_qty > 0),
  created_at        timestamptz not null,
  updated_at        timestamptz not null,
  deleted_at        timestamptz,
  version           integer not null default 1,
  updated_by_device uuid not null,
  server_seq        bigint not null,
  server_updated_at timestamptz not null default now()
);
-- Único entre los vigentes: un código borrado se puede reasignar.
create unique index barcodes_code_uq on barcodes (code) where deleted_at is null;
create index barcodes_product_idx on barcodes (product_id);
create index barcodes_server_seq_idx on barcodes (server_seq);
create trigger barcodes_sync before insert or update on barcodes for each row execute function tg_sync_stamp();

-- Precio diferenciado por sucursal (opcional). Sin fila = precio del producto.
create table store_prices (
  store_id          uuid not null references stores (id),
  product_id        uuid not null references products (id),
  price_cents       bigint not null check (price_cents >= 0),
  min_stock         numeric(14, 3) check (min_stock >= 0),
  updated_at        timestamptz not null,
  updated_by_device uuid not null,
  server_seq        bigint not null,
  server_updated_at timestamptz not null default now(),
  primary key (store_id, product_id)
);
create index store_prices_product_idx on store_prices (product_id);
create index store_prices_server_seq_idx on store_prices (server_seq);
create trigger store_prices_sync before insert or update on store_prices for each row execute function tg_sync_stamp();

-- ===== 0003_inventory.sql =====
-- RED MINI POS · 0003 · Inventario.
-- Regla de oro: el stock NUNCA se escribe directo. Sólo se insertan movimientos (append-only)
-- y un trigger mantiene `stock` como proyección. Consecuencias:
--   · trazabilidad total (cada unidad tiene un porqué);
--   · dos sucursales vendiendo offline al mismo tiempo nunca generan conflicto: se suman deltas;
--   · el stock se puede recalcular desde cero en cualquier momento (rebuild_stock).

create type stock_movement_type as enum (
  'initial',        -- carga inicial / migración desde Eleventa
  'sale',           -- venta (cantidad negativa)
  'sale_void',      -- anulación de venta (positiva)
  'purchase',       -- recepción de compra
  'purchase_return',
  'adjustment',     -- ajuste por conteo, rotura, vencimiento
  'transfer_out',
  'transfer_in'
);

create table stock (
  store_id          uuid not null references stores (id),
  product_id        uuid not null references products (id),
  quantity          numeric(14, 3) not null default 0,
  updated_at        timestamptz not null default now(),
  server_seq        bigint not null,
  server_updated_at timestamptz not null default now(),
  primary key (store_id, product_id)
);
create index stock_product_idx on stock (product_id);
create index stock_server_seq_idx on stock (server_seq);
create trigger stock_sync before insert or update on stock for each row execute function tg_sync_stamp();

create table stock_movements (
  id                uuid primary key,
  store_id          uuid not null references stores (id),
  product_id        uuid not null references products (id),
  type              stock_movement_type not null,
  quantity          numeric(14, 3) not null check (quantity <> 0),  -- con signo
  unit_cost_cents   bigint check (unit_cost_cents >= 0),
  reason            text,
  reference_type    text check (reference_type in ('sale', 'purchase', 'transfer', 'count')),
  reference_id      uuid,
  transfer_id       uuid,                                           -- agrupa transfer_out + transfer_in
  user_id           uuid references users (id),
  device_id         uuid not null,
  occurred_at       timestamptz not null,                           -- hora del dispositivo
  created_at        timestamptz not null default now(),
  server_seq        bigint not null,
  server_updated_at timestamptz not null default now(),
  check (
    (type in ('sale', 'transfer_out', 'purchase_return') and quantity < 0) or
    (type in ('sale_void', 'purchase', 'transfer_in', 'initial') and quantity > 0) or
    type = 'adjustment'
  ),
  check (type not in ('adjustment') or reason is not null)
);
create index stock_movements_store_product_idx on stock_movements (store_id, product_id, occurred_at desc);
create index stock_movements_product_idx on stock_movements (product_id, occurred_at desc);
create index stock_movements_reference_idx on stock_movements (reference_type, reference_id);
create index stock_movements_transfer_idx on stock_movements (transfer_id) where transfer_id is not null;
create index stock_movements_server_seq_idx on stock_movements (server_seq);
create trigger stock_movements_sync before insert on stock_movements for each row execute function tg_sync_stamp();
create trigger stock_movements_immutable before update or delete on stock_movements for each row execute function tg_append_only();

create or replace function tg_apply_stock_movement() returns trigger
language plpgsql as $$
begin
  insert into stock (store_id, product_id, quantity, updated_at, server_seq)
  values (new.store_id, new.product_id, new.quantity, now(), 0)
  on conflict (store_id, product_id)
  do update set quantity = stock.quantity + excluded.quantity, updated_at = now();
  return new;
end $$;

create trigger stock_movements_apply after insert on stock_movements
  for each row execute function tg_apply_stock_movement();

-- Recalcula la proyección desde los movimientos (auditoría / reparación).
create or replace function rebuild_stock(p_store uuid default null) returns void
language plpgsql as $$
begin
  delete from stock where p_store is null or store_id = p_store;
  insert into stock (store_id, product_id, quantity, server_seq)
  select store_id, product_id, sum(quantity), 0
  from stock_movements
  where p_store is null or store_id = p_store
  group by store_id, product_id;
end $$;

-- ===== 0004_sales.sql =====
-- RED MINI POS · 0004 · Ventas, pagos y caja.
-- Una venta confirmada es inmutable: anularla es otra operación (status + movimientos sale_void).
-- Los ítems guardan snapshot de nombre, precio y COSTO al momento de vender: la rentabilidad
-- histórica no cambia aunque después se actualicen los precios.

create type sale_status as enum ('completed', 'voided');
create type payment_method as enum ('cash', 'debit', 'credit', 'transfer', 'mercadopago');

create table cash_sessions (
  id                uuid primary key,
  store_id          uuid not null references stores (id),
  device_id         uuid not null,
  opened_by         uuid references users (id),
  opened_at         timestamptz not null,
  opening_cents     bigint not null default 0 check (opening_cents >= 0),
  closed_by         uuid references users (id),
  closed_at         timestamptz,
  expected_cents    bigint,
  counted_cents     bigint,
  notes             text,
  created_at        timestamptz not null,
  updated_at        timestamptz not null,
  version           integer not null default 1,
  updated_by_device uuid not null,
  server_seq        bigint not null,
  server_updated_at timestamptz not null default now(),
  check (closed_at is null or closed_at >= opened_at)
);
-- Una sola caja abierta por dispositivo.
create unique index cash_sessions_open_uq on cash_sessions (device_id) where closed_at is null;
create index cash_sessions_store_idx on cash_sessions (store_id, opened_at desc);
create index cash_sessions_server_seq_idx on cash_sessions (server_seq);
create trigger cash_sessions_sync before insert or update on cash_sessions for each row execute function tg_sync_stamp();

create table cash_movements (
  id                uuid primary key,
  cash_session_id   uuid not null references cash_sessions (id),
  type              text not null check (type in ('deposit', 'withdrawal')),
  amount_cents      bigint not null check (amount_cents > 0),
  reason            text not null,
  user_id           uuid references users (id),
  device_id         uuid not null,
  occurred_at       timestamptz not null,
  server_seq        bigint not null,
  server_updated_at timestamptz not null default now()
);
create index cash_movements_session_idx on cash_movements (cash_session_id);
create index cash_movements_server_seq_idx on cash_movements (server_seq);
create trigger cash_movements_sync before insert on cash_movements for each row execute function tg_sync_stamp();
create trigger cash_movements_immutable before update or delete on cash_movements for each row execute function tg_append_only();

create table sales (
  id                uuid primary key,
  store_id          uuid not null references stores (id),
  device_id         uuid not null,
  cash_session_id   uuid references cash_sessions (id),
  user_id           uuid references users (id),
  number            text not null,              -- ORO-02-000123 (único sin coordinación online)
  status            sale_status not null default 'completed',
  subtotal_cents    bigint not null check (subtotal_cents >= 0),
  discount_cents    bigint not null default 0 check (discount_cents >= 0),
  total_cents       bigint not null check (total_cents >= 0),
  customer_note     text,
  occurred_at       timestamptz not null,
  voided_at         timestamptz,
  voided_by         uuid references users (id),
  void_reason       text,
  created_at        timestamptz not null,
  updated_at        timestamptz not null,
  version           integer not null default 1,
  updated_by_device uuid not null,
  server_seq        bigint not null,
  server_updated_at timestamptz not null default now(),
  unique (store_id, number),
  check (total_cents = subtotal_cents - discount_cents),
  check ((status = 'voided') = (voided_at is not null)),
  check (status <> 'voided' or void_reason is not null)
);
create index sales_store_time_idx on sales (store_id, occurred_at desc);
create index sales_time_idx on sales (occurred_at desc);
create index sales_cash_session_idx on sales (cash_session_id);
create index sales_server_seq_idx on sales (server_seq);
create trigger sales_sync before insert or update on sales for each row execute function tg_sync_stamp();

-- Sólo se permite pasar de completed a voided; el resto de la venta queda congelado.
create or replace function tg_sales_guard() returns trigger
language plpgsql as $$
begin
  if old.status = 'voided' then
    raise exception 'La venta % ya está anulada', old.number;
  end if;
  if new.total_cents <> old.total_cents or new.subtotal_cents <> old.subtotal_cents
     or new.discount_cents <> old.discount_cents or new.store_id <> old.store_id
     or new.number <> old.number or new.occurred_at <> old.occurred_at then
    raise exception 'Una venta confirmada no puede modificarse; sólo anularse';
  end if;
  return new;
end $$;
create trigger sales_guard before update on sales for each row execute function tg_sales_guard();
create trigger sales_no_delete before delete on sales for each row execute function tg_append_only();

create table sale_items (
  id                uuid primary key,
  sale_id           uuid not null references sales (id),
  line              smallint not null check (line > 0),
  product_id        uuid references products (id),  -- null = ítem libre ("varios")
  barcode           text,
  description       text not null,
  quantity          numeric(14, 3) not null check (quantity > 0),
  unit_price_cents  bigint not null check (unit_price_cents >= 0),
  unit_cost_cents   bigint not null default 0 check (unit_cost_cents >= 0),
  discount_cents    bigint not null default 0 check (discount_cents >= 0),
  total_cents       bigint not null check (total_cents >= 0),
  server_seq        bigint not null,
  server_updated_at timestamptz not null default now(),
  unique (sale_id, line)
);
create index sale_items_product_idx on sale_items (product_id);
create index sale_items_server_seq_idx on sale_items (server_seq);
create trigger sale_items_sync before insert on sale_items for each row execute function tg_sync_stamp();
create trigger sale_items_immutable before update or delete on sale_items for each row execute function tg_append_only();

create table payments (
  id                uuid primary key,
  sale_id           uuid not null references sales (id),
  method            payment_method not null,
  amount_cents      bigint not null check (amount_cents > 0),   -- lo imputado a la venta
  tendered_cents    bigint check (tendered_cents >= amount_cents), -- lo entregado (efectivo)
  change_cents      bigint generated always as (coalesce(tendered_cents, amount_cents) - amount_cents) stored,
  reference         text,                                         -- nro. de operación / cupón / MP
  occurred_at       timestamptz not null,
  server_seq        bigint not null,
  server_updated_at timestamptz not null default now()
);
create index payments_sale_idx on payments (sale_id);
create index payments_method_time_idx on payments (method, occurred_at desc);
create index payments_server_seq_idx on payments (server_seq);
create trigger payments_sync before insert on payments for each row execute function tg_sync_stamp();
create trigger payments_immutable before update or delete on payments for each row execute function tg_append_only();

-- ===== 0005_purchases.sql =====
-- RED MINI POS · 0005 · Compras y proveedores.

create table suppliers (
  id                uuid primary key,
  name              text not null check (length(trim(name)) > 0),
  tax_id            text,                       -- CUIT
  phone             text,
  email             text,
  notes             text,
  active            boolean not null default true,
  created_at        timestamptz not null,
  updated_at        timestamptz not null,
  deleted_at        timestamptz,
  version           integer not null default 1,
  updated_by_device uuid not null,
  server_seq        bigint not null,
  server_updated_at timestamptz not null default now()
);
create unique index suppliers_tax_id_uq on suppliers (tax_id) where tax_id is not null and deleted_at is null;
create index suppliers_name_trgm_idx on suppliers using gin (name gin_trgm_ops);
create index suppliers_server_seq_idx on suppliers (server_seq);
create trigger suppliers_sync before insert or update on suppliers for each row execute function tg_sync_stamp();

create type purchase_status as enum ('draft', 'received', 'cancelled');

create table purchases (
  id                uuid primary key,
  store_id          uuid not null references stores (id),
  supplier_id       uuid references suppliers (id),
  status            purchase_status not null default 'draft',
  invoice_type      text check (invoice_type in ('A', 'B', 'C', 'X', 'remito')),
  invoice_number    text,
  invoice_date      date,
  invoice_path      text,                       -- foto/PDF de la factura en Storage
  subtotal_cents    bigint not null default 0 check (subtotal_cents >= 0),
  tax_cents         bigint not null default 0 check (tax_cents >= 0),
  total_cents       bigint not null default 0 check (total_cents >= 0),
  received_at       timestamptz,
  received_by       uuid references users (id),
  notes             text,
  created_at        timestamptz not null,
  updated_at        timestamptz not null,
  deleted_at        timestamptz,
  version           integer not null default 1,
  updated_by_device uuid not null,
  server_seq        bigint not null,
  server_updated_at timestamptz not null default now(),
  check ((status = 'received') = (received_at is not null))
);
create unique index purchases_invoice_uq on purchases (supplier_id, invoice_type, invoice_number)
  where invoice_number is not null and status <> 'cancelled';
create index purchases_store_time_idx on purchases (store_id, created_at desc);
create index purchases_supplier_idx on purchases (supplier_id);
create index purchases_server_seq_idx on purchases (server_seq);
create trigger purchases_sync before insert or update on purchases for each row execute function tg_sync_stamp();

create table purchase_items (
  id                uuid primary key,
  purchase_id       uuid not null references purchases (id),
  product_id        uuid not null references products (id),
  quantity          numeric(14, 3) not null check (quantity > 0),
  unit_cost_cents   bigint not null check (unit_cost_cents >= 0),
  total_cents       bigint not null check (total_cents >= 0),
  updated_at        timestamptz not null,
  server_seq        bigint not null,
  server_updated_at timestamptz not null default now()
);
create index purchase_items_purchase_idx on purchase_items (purchase_id);
create index purchase_items_product_idx on purchase_items (product_id);
create index purchase_items_server_seq_idx on purchase_items (server_seq);
create trigger purchase_items_sync before insert or update on purchase_items for each row execute function tg_sync_stamp();

-- Historial de costos: cada cambio de costo (por compra o manual) queda registrado.
create table product_cost_history (
  id                uuid primary key,
  product_id        uuid not null references products (id),
  supplier_id       uuid references suppliers (id),
  purchase_id       uuid references purchases (id),
  cost_cents        bigint not null check (cost_cents >= 0),
  effective_at      timestamptz not null,
  device_id         uuid not null,
  server_seq        bigint not null,
  server_updated_at timestamptz not null default now()
);
create index product_cost_history_product_idx on product_cost_history (product_id, effective_at desc);
create index product_cost_history_server_seq_idx on product_cost_history (server_seq);
create trigger product_cost_history_sync before insert on product_cost_history for each row execute function tg_sync_stamp();
create trigger product_cost_history_immutable before update or delete on product_cost_history for each row execute function tg_append_only();

-- ===== 0006_sync.sql =====
-- RED MINI POS · 0006 · Registro de sincronización (lado servidor).
-- Cada operación que llega de un dispositivo se registra con el MISMO id que tenía en su
-- `sync_queue` local. Reenviar una operación (por corte de red a mitad de respuesta) es
-- idempotente: el id ya existe y se responde OK sin aplicarla dos veces.

create type sync_op as enum ('upsert', 'delete');
create type sync_result as enum ('applied', 'duplicate', 'conflict_resolved', 'rejected');

create table sync_queue (
  id                uuid primary key,           -- = SyncQueueEntry.id del dispositivo
  device_id         uuid not null,
  store_id          uuid references stores (id),
  table_name        text not null,
  record_id         uuid not null,
  op                sync_op not null,
  payload           jsonb not null,
  client_version    integer,
  client_created_at timestamptz not null,
  received_at       timestamptz not null default now(),
  result            sync_result not null,
  detail            text                        -- motivo de rechazo / cómo se resolvió el conflicto
);
create index sync_queue_device_idx on sync_queue (device_id, received_at desc);
create index sync_queue_record_idx on sync_queue (table_name, record_id, received_at desc);
create index sync_queue_rejected_idx on sync_queue (received_at desc) where result in ('rejected', 'conflict_resolved');

-- Trazabilidad: el log es inmutable.
create trigger sync_queue_immutable before update or delete on sync_queue
  for each row execute function tg_append_only();

-- RLS: se activa en la Etapa 4 junto con Supabase Auth (políticas por sucursal y rol).

-- ===== 0007_auth_and_pos.sql =====
-- RED MINI POS · 0007 · Login por usuario y contraseña, y cobro genérico con tarjeta.

alter table users add column username text;
alter table users add column password_hash text;   -- pbkdf2$iteraciones$sal$hash
update users set username = lower(coalesce(email, id::text)) where username is null;
alter table users alter column username set not null;
alter table users add constraint users_username_uq unique (username);
alter table users add constraint users_username_lower check (username = lower(username));
alter table users drop column pin_hash;

-- Tarjeta sin distinguir débito/crédito (la vista de venta ofrece Efectivo, Tarjeta y Mixto).
alter type payment_method add value if not exists 'card';

insert into permissions (key, description) values ('settings.manage', 'Ajustes del dispositivo')
  on conflict (key) do nothing;
insert into role_permissions (role, permission_key) values ('manager', 'settings.manage')
  on conflict do nothing;

-- ===== 0008_store_and_min_stock.sql =====
-- RED MINI POS · 0008 · Sucursal fija por usuario y stock mínimo automático.

-- null = puede moverse entre sucursales; con valor, queda fijo en esa (cajero).
alter table users add column store_id uuid references stores (id);
create index users_store_idx on users (store_id);

-- true: el mínimo se recalcula con las ventas; products.min_stock queda como valor inicial.
alter table products add column auto_min_stock boolean not null default true;

-- Mínimo calculado por sucursal. Se deriva de las ventas, así que se puede recalcular en cualquier momento.
create table store_min_stock (
  store_id    uuid not null references stores (id),
  product_id  uuid not null references products (id),
  min_stock   numeric(14, 3) not null check (min_stock >= 0),
  weekly_avg  numeric(14, 3) not null check (weekly_avg >= 0),
  computed_at timestamptz not null,
  primary key (store_id, product_id)
);
create index store_min_stock_product_idx on store_min_stock (product_id);

-- ===== 0009_inventory_kind.sql =====
-- RED MINI POS · 0009 · Distingue entrada, salida y conteo dentro de los movimientos de tipo adjustment.

alter table stock_movements add column kind text check (kind in ('entry', 'exit', 'count'));

-- ===== 0010_employee_accounts.sql =====
-- RED MINI POS · 0010 · Cuentas de empleados: lo que sacan para descontar del sueldo.

alter type payment_method add value if not exists 'employee_account';

create table employee_accounts (
  id                uuid primary key,
  name              text not null check (length(trim(name)) > 0),
  limit_cents       bigint not null check (limit_cents >= 0),
  active            boolean not null default true,
  created_at        timestamptz not null,
  updated_at        timestamptz not null,
  deleted_at        timestamptz,
  version           integer not null default 1,
  updated_by_device uuid not null,
  server_seq        bigint not null,
  server_updated_at timestamptz not null default now()
);
create index employee_accounts_server_seq_idx on employee_accounts (server_seq);
create trigger employee_accounts_sync before insert or update on employee_accounts for each row execute function tg_sync_stamp();

-- El saldo es la suma de los movimientos: positivo = compra, negativo = anulación o descuento del sueldo.
create table account_movements (
  id                uuid primary key,
  account_id        uuid not null references employee_accounts (id),
  type              text not null check (type in ('charge', 'charge_void', 'settlement')),
  amount_cents      bigint not null check (amount_cents <> 0),
  sale_id           uuid references sales (id),
  store_id          uuid not null references stores (id),
  user_id           uuid references users (id),
  device_id         uuid not null,
  note              text,
  occurred_at       timestamptz not null,
  server_seq        bigint not null,
  server_updated_at timestamptz not null default now(),
  check ((type = 'charge') = (amount_cents > 0))
);
create index account_movements_account_idx on account_movements (account_id, occurred_at desc);
create index account_movements_sale_idx on account_movements (sale_id);
create index account_movements_server_seq_idx on account_movements (server_seq);
create trigger account_movements_sync before insert on account_movements for each row execute function tg_sync_stamp();
create trigger account_movements_immutable before update or delete on account_movements for each row execute function tg_append_only();

alter table payments add column account_id uuid references employee_accounts (id);
create index payments_account_idx on payments (account_id);

insert into permissions (key, description) values ('accounts.manage', 'Administrar cuentas de empleados')
  on conflict (key) do nothing;
insert into role_permissions (role, permission_key) values ('manager', 'accounts.manage')
  on conflict do nothing;

-- ===== 0011_sync.sql =====
-- RED MINI POS · 0011 · Sincronización. El servidor es un buzón: los dispositivos sólo hablan con
-- sync_push y sync_pull, y ninguna tabla se puede leer o escribir directamente.

alter table users add column permissions jsonb not null default '{}';

-- Dos dispositivos sin Internet pueden crear la misma categoría. Rechazar la segunda dejaría
-- trabados los productos que dependen de ella; es preferible permitir el nombre repetido.
drop index categories_name_uq;

-- Únicos correos autorizados a sincronizar, aunque alguien logre crearse una cuenta en el proyecto.
create table sync_members (
  email text primary key check (email = lower(email))
);

-- Avisa a los demás dispositivos de las filas borradas (sólo líneas de un borrador de compra).
create table sync_deletes (
  table_name text not null,
  record_id  uuid not null,
  server_seq bigint not null,
  primary key (table_name, record_id)
);
create index sync_deletes_server_seq_idx on sync_deletes (server_seq);

create function sync_assert_member() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from sync_members where email = lower(coalesce(auth.jwt() ->> 'email', ''))) then
    raise exception 'Este usuario no está autorizado a sincronizar' using errcode = '42501';
  end if;
end $$;

-- Aplica un cambio y devuelve applied, duplicate o conflict_resolved. Si no se puede aplicar, lanza un error.
create function sync_apply_op(p_table text, p_op text, p_id uuid, p jsonb) returns sync_result
language plpgsql security definer set search_path = public as $$
declare
  cols text;
  n integer;
  cur_version integer;
  cur_updated timestamptz;
begin
  if p_op = 'delete' then
    if p_table <> 'purchase_items' then
      raise exception 'No se permite borrar filas de %', p_table;
    end if;
    delete from purchase_items where id = p_id;
    insert into sync_deletes (table_name, record_id, server_seq) values (p_table, p_id, nextval('sync_seq'))
      on conflict (table_name, record_id) do update set server_seq = excluded.server_seq;
    return 'applied';
  end if;

  -- Sólo las columnas que trae el cambio: las demás usan su valor por defecto.
  select string_agg(quote_ident(c.column_name), ', ') into cols
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = p_table and c.is_generated = 'NEVER'
    and c.column_name not in ('server_seq', 'server_updated_at') and p ? c.column_name;

  if p_table in ('stock_movements', 'sale_items', 'payments', 'product_cost_history', 'account_movements', 'purchase_items') then
    -- Sin conflictos posibles: id único y filas inmutables. Reenviar no duplica.
    execute format('insert into %I (%s) select %s from jsonb_populate_record(null::%I, $1) on conflict (id) do nothing', p_table, cols, cols, p_table) using p;
    get diagnostics n = row_count;
    return case when n > 0 then 'applied' else 'duplicate' end::sync_result;
  end if;

  if p_table not in ('stores', 'users', 'categories', 'products', 'barcodes', 'suppliers', 'purchases', 'employee_accounts', 'sales') then
    raise exception 'Tabla no sincronizable: %', p_table;
  end if;

  execute format('select version, updated_at from %I where id = $1', p_table) into cur_version, cur_updated using p_id;
  if cur_version is null then
    execute format('insert into %I (%s) select %s from jsonb_populate_record(null::%I, $1)', p_table, cols, cols, p_table) using p;
    return 'applied';
  end if;

  -- Gana la versión más alta y, si empatan, el cambio más reciente.
  if (p ->> 'version')::integer > cur_version
     or ((p ->> 'version')::integer = cur_version and (p ->> 'updated_at')::timestamptz > cur_updated) then
    execute format('update %I set (%s) = (select %s from jsonb_populate_record(null::%I, $1)) where id = $2', p_table, cols, cols, p_table) using p, p_id;
    return 'applied';
  end if;
  return 'conflict_resolved';
end $$;

create function sync_push(p_device uuid, p_ops jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  item jsonb;
  res sync_result;
  results jsonb := '[]';
begin
  perform sync_assert_member();
  -- De a un dispositivo por vez: así server_seq crece en el mismo orden en que se confirma,
  -- y un dispositivo que baja cambios nunca se saltea uno confirmado más tarde con un número menor.
  perform pg_advisory_xact_lock(727001);

  for item in select * from jsonb_array_elements(p_ops) loop
    begin
      if exists (select 1 from sync_queue where id = (item ->> 'id')::uuid) then
        res := 'duplicate';
      else
        res := sync_apply_op(item ->> 'table', item ->> 'op', (item ->> 'record_id')::uuid, item -> 'payload');
        insert into sync_queue (id, device_id, store_id, table_name, record_id, op, payload, client_version, client_created_at, result)
        values (
          (item ->> 'id')::uuid, p_device, null, item ->> 'table', (item ->> 'record_id')::uuid, (item ->> 'op')::sync_op, item -> 'payload',
          (item -> 'payload' ->> 'version')::integer, (item ->> 'created_at')::timestamptz, res
        );
      end if;
      results := results || jsonb_build_object('id', item ->> 'id', 'result', res);
    exception when others then
      -- No se registra en el log: el dispositivo conserva el cambio y puede reintentarlo con el mismo id.
      results := results || jsonb_build_object('id', item ->> 'id', 'result', 'rejected', 'detail', sqlerrm);
    end;
  end loop;
  return results;
end $$;

-- p_store: null = todo; con valor = el catálogo compartido y sólo lo de esa sucursal.
create function sync_pull(p_cursor bigint, p_store uuid default null, p_limit integer default 500) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  rows jsonb;
  total integer;
begin
  perform sync_assert_member();

  with changes as (
    select 'stores' as t, server_seq as seq, to_jsonb(x) as r from stores x where server_seq > p_cursor
    union all select 'users', server_seq, to_jsonb(x) from users x where server_seq > p_cursor
    union all select 'categories', server_seq, to_jsonb(x) from categories x where server_seq > p_cursor
    union all select 'products', server_seq, to_jsonb(x) from products x where server_seq > p_cursor
    union all select 'barcodes', server_seq, to_jsonb(x) from barcodes x where server_seq > p_cursor
    union all select 'suppliers', server_seq, to_jsonb(x) from suppliers x where server_seq > p_cursor
    union all select 'employee_accounts', server_seq, to_jsonb(x) from employee_accounts x where server_seq > p_cursor
    union all select 'account_movements', server_seq, to_jsonb(x) from account_movements x where server_seq > p_cursor
    union all select 'product_cost_history', server_seq, to_jsonb(x) from product_cost_history x where server_seq > p_cursor
    union all select 'stock_movements', server_seq, to_jsonb(x) from stock_movements x
      where server_seq > p_cursor and (p_store is null or store_id = p_store)
    union all select 'sales', server_seq, to_jsonb(x) from sales x
      where server_seq > p_cursor and (p_store is null or store_id = p_store)
    union all select 'sale_items', x.server_seq, to_jsonb(x) from sale_items x join sales s on s.id = x.sale_id
      where x.server_seq > p_cursor and (p_store is null or s.store_id = p_store)
    union all select 'payments', x.server_seq, to_jsonb(x) from payments x join sales s on s.id = x.sale_id
      where x.server_seq > p_cursor and (p_store is null or s.store_id = p_store)
    union all select 'purchases', server_seq, to_jsonb(x) from purchases x
      where server_seq > p_cursor and (p_store is null or store_id = p_store)
    union all select 'purchase_items', x.server_seq, to_jsonb(x) from purchase_items x join purchases p on p.id = x.purchase_id
      where x.server_seq > p_cursor and (p_store is null or p.store_id = p_store)
    union all select 'deleted:' || table_name, server_seq, jsonb_build_object('id', record_id) from sync_deletes where server_seq > p_cursor
  ), page as (
    select * from changes order by seq limit p_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('table', t, 'seq', seq, 'row', r - 'server_seq' - 'server_updated_at') order by seq), '[]'), count(*)
  into rows, total from page;

  if total > p_limit then
    rows := rows - p_limit;
  end if;

  return jsonb_build_object(
    'changes', rows,
    'next_cursor', coalesce((rows -> -1 ->> 'seq')::bigint, p_cursor),
    'has_more', total > p_limit
  );
end $$;

-- Acceso: sólo las dos funciones de arriba, y sólo con sesión iniciada.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from anon, authenticated', t);
  end loop;
end $$;

revoke all on sequence sync_seq from anon, authenticated;
revoke all on function sync_assert_member() from public, anon, authenticated;
revoke all on function sync_apply_op(text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function sync_push(uuid, jsonb) from public, anon, authenticated;
revoke all on function sync_pull(bigint, uuid, integer) from public, anon, authenticated;
revoke all on function user_has_permission(uuid, text) from public, anon, authenticated;
revoke all on function rebuild_stock(uuid) from public, anon, authenticated;
grant execute on function sync_push(uuid, jsonb) to authenticated;
grant execute on function sync_pull(bigint, uuid, integer) to authenticated;

-- ===== 0012_cash.sql =====
-- RED MINI POS · 0012 · Caja por cajero.
-- Suma las cajas (cash_sessions) y sus retiros (cash_movements) a la sincronización.
-- Es compatible con la versión anterior de la app: correr ANTES de actualizar los dispositivos.

-- Categorías comestibles: los productos que no rotan avisan para revisar vencimientos.
alter table categories add column if not exists perishable boolean not null default false;

create or replace function sync_apply_op(p_table text, p_op text, p_id uuid, p jsonb) returns sync_result
language plpgsql security definer set search_path = public as $$
declare
  cols text;
  n integer;
  cur_version integer;
  cur_updated timestamptz;
begin
  if p_op = 'delete' then
    if p_table <> 'purchase_items' then
      raise exception 'No se permite borrar filas de %', p_table;
    end if;
    delete from purchase_items where id = p_id;
    insert into sync_deletes (table_name, record_id, server_seq) values (p_table, p_id, nextval('sync_seq'))
      on conflict (table_name, record_id) do update set server_seq = excluded.server_seq;
    return 'applied';
  end if;

  -- Sólo las columnas que trae el cambio: las demás usan su valor por defecto.
  select string_agg(quote_ident(c.column_name), ', ') into cols
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = p_table and c.is_generated = 'NEVER'
    and c.column_name not in ('server_seq', 'server_updated_at') and p ? c.column_name;

  if p_table in ('stock_movements', 'sale_items', 'payments', 'product_cost_history', 'account_movements', 'purchase_items', 'cash_movements') then
    -- Sin conflictos posibles: id único y filas inmutables. Reenviar no duplica.
    execute format('insert into %I (%s) select %s from jsonb_populate_record(null::%I, $1) on conflict (id) do nothing', p_table, cols, cols, p_table) using p;
    get diagnostics n = row_count;
    return case when n > 0 then 'applied' else 'duplicate' end::sync_result;
  end if;

  if p_table not in ('stores', 'users', 'categories', 'products', 'barcodes', 'suppliers', 'purchases', 'employee_accounts', 'sales', 'cash_sessions') then
    raise exception 'Tabla no sincronizable: %', p_table;
  end if;

  execute format('select version, updated_at from %I where id = $1', p_table) into cur_version, cur_updated using p_id;
  if cur_version is null then
    execute format('insert into %I (%s) select %s from jsonb_populate_record(null::%I, $1)', p_table, cols, cols, p_table) using p;
    return 'applied';
  end if;

  -- Gana la versión más alta y, si empatan, el cambio más reciente.
  if (p ->> 'version')::integer > cur_version
     or ((p ->> 'version')::integer = cur_version and (p ->> 'updated_at')::timestamptz > cur_updated) then
    execute format('update %I set (%s) = (select %s from jsonb_populate_record(null::%I, $1)) where id = $2', p_table, cols, cols, p_table) using p, p_id;
    return 'applied';
  end if;
  return 'conflict_resolved';
end $$;

-- p_store: null = todo; con valor = el catálogo compartido y sólo lo de esa sucursal.
create or replace function sync_pull(p_cursor bigint, p_store uuid default null, p_limit integer default 500) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  rows jsonb;
  total integer;
begin
  perform sync_assert_member();

  with changes as (
    select 'stores' as t, server_seq as seq, to_jsonb(x) as r from stores x where server_seq > p_cursor
    union all select 'users', server_seq, to_jsonb(x) from users x where server_seq > p_cursor
    union all select 'categories', server_seq, to_jsonb(x) from categories x where server_seq > p_cursor
    union all select 'products', server_seq, to_jsonb(x) from products x where server_seq > p_cursor
    union all select 'barcodes', server_seq, to_jsonb(x) from barcodes x where server_seq > p_cursor
    union all select 'suppliers', server_seq, to_jsonb(x) from suppliers x where server_seq > p_cursor
    union all select 'employee_accounts', server_seq, to_jsonb(x) from employee_accounts x where server_seq > p_cursor
    union all select 'account_movements', server_seq, to_jsonb(x) from account_movements x where server_seq > p_cursor
    union all select 'product_cost_history', server_seq, to_jsonb(x) from product_cost_history x where server_seq > p_cursor
    union all select 'stock_movements', server_seq, to_jsonb(x) from stock_movements x
      where server_seq > p_cursor and (p_store is null or store_id = p_store)
    union all select 'sales', server_seq, to_jsonb(x) from sales x
      where server_seq > p_cursor and (p_store is null or store_id = p_store)
    union all select 'sale_items', x.server_seq, to_jsonb(x) from sale_items x join sales s on s.id = x.sale_id
      where x.server_seq > p_cursor and (p_store is null or s.store_id = p_store)
    union all select 'payments', x.server_seq, to_jsonb(x) from payments x join sales s on s.id = x.sale_id
      where x.server_seq > p_cursor and (p_store is null or s.store_id = p_store)
    union all select 'purchases', server_seq, to_jsonb(x) from purchases x
      where server_seq > p_cursor and (p_store is null or store_id = p_store)
    union all select 'purchase_items', x.server_seq, to_jsonb(x) from purchase_items x join purchases p on p.id = x.purchase_id
      where x.server_seq > p_cursor and (p_store is null or p.store_id = p_store)
    union all select 'cash_sessions', server_seq, to_jsonb(x) from cash_sessions x
      where server_seq > p_cursor and (p_store is null or store_id = p_store)
    union all select 'cash_movements', x.server_seq, to_jsonb(x) from cash_movements x join cash_sessions c on c.id = x.cash_session_id
      where x.server_seq > p_cursor and (p_store is null or c.store_id = p_store)
    union all select 'deleted:' || table_name, server_seq, jsonb_build_object('id', record_id) from sync_deletes where server_seq > p_cursor
  ), page as (
    select * from changes order by seq limit p_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('table', t, 'seq', seq, 'row', r - 'server_seq' - 'server_updated_at') order by seq), '[]'), count(*)
  into rows, total from page;

  if total > p_limit then
    rows := rows - p_limit;
  end if;

  return jsonb_build_object(
    'changes', rows,
    'next_cursor', coalesce((rows -> -1 ->> 'seq')::bigint, p_cursor),
    'has_more', total > p_limit
  );
end $$;

