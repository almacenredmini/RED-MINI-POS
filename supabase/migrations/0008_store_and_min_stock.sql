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
