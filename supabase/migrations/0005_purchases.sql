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
