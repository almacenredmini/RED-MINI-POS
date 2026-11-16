-- RED MINI POS · 0018 · Devoluciones de productos de un ticket.
-- Cada devolución es un registro inmutable: el ticket original no se toca. Resta de las ventas del día
-- en que se devuelve y la plata sale de la caja donde se hizo.
-- Es compatible con la versión anterior de la app: correr ANTES de actualizar los dispositivos.

create table if not exists sale_returns (
  id                uuid primary key,
  sale_id           uuid not null references sales (id),
  sale_item_id      uuid not null references sale_items (id),
  store_id          uuid not null,
  cash_session_id   uuid not null,
  product_id        uuid,
  description       text not null,
  quantity          numeric(14, 3) not null check (quantity > 0),
  unit_price_cents  bigint not null check (unit_price_cents >= 0),
  unit_cost_cents   bigint not null default 0 check (unit_cost_cents >= 0),
  total_cents       bigint not null check (total_cents >= 0),
  refund_method     text not null check (refund_method in ('cash', 'employee_account')),
  account_id        uuid,
  reason            text not null,
  user_id           uuid,
  device_id         uuid not null,
  occurred_at       timestamptz not null,
  server_seq        bigint not null,
  server_updated_at timestamptz not null default now()
);
create index if not exists sale_returns_sale_idx on sale_returns (sale_id);
create index if not exists sale_returns_server_seq_idx on sale_returns (server_seq);
drop trigger if exists sale_returns_sync on sale_returns;
create trigger sale_returns_sync before insert on sale_returns for each row execute function tg_sync_stamp();
drop trigger if exists sale_returns_immutable on sale_returns;
create trigger sale_returns_immutable before update or delete on sale_returns for each row execute function tg_append_only();
alter table sale_returns enable row level security;
revoke all on table sale_returns from anon, authenticated;

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

  if p_table in ('stock_movements', 'sale_items', 'payments', 'product_cost_history', 'account_movements', 'purchase_items', 'cash_movements', 'product_changes', 'screen_exits', 'sale_returns') then
    -- Sin conflictos posibles: id único y filas inmutables. Reenviar no duplica.
    execute format('insert into %I (%s) select %s from jsonb_populate_record(null::%I, $1) on conflict (id) do nothing', p_table, cols, cols, p_table) using p;
    get diagnostics n = row_count;
    return case when n > 0 then 'applied' else 'duplicate' end::sync_result;
  end if;

  if p_table not in ('stores', 'users', 'categories', 'products', 'barcodes', 'suppliers', 'purchases', 'employee_accounts', 'sales', 'cash_sessions', 'staff_schedules', 'supplier_invoices') then
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
    union all select 'product_changes', server_seq, to_jsonb(x) from product_changes x where server_seq > p_cursor
    union all select 'staff_schedules', server_seq, to_jsonb(x) from staff_schedules x
      where server_seq > p_cursor and (p_store is null or store_id = p_store)
    union all select 'supplier_invoices', server_seq, to_jsonb(x) from supplier_invoices x
      where server_seq > p_cursor and (p_store is null or store_id = p_store)
    union all select 'screen_exits', server_seq, to_jsonb(x) from screen_exits x
      where server_seq > p_cursor and (p_store is null or store_id = p_store)
    union all select 'sale_returns', server_seq, to_jsonb(x) from sale_returns x
      where server_seq > p_cursor and (p_store is null or store_id = p_store)
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

