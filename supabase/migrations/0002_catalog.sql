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
