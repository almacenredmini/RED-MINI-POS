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
