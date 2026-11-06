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
