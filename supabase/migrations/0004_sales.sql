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
