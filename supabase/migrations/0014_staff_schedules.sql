-- RED MINI POS · 0014 · Horarios semanales del personal.
-- Un horario por persona y sucursal: los turnos de cada día de la semana se repiten todas las semanas.
-- Es compatible con la versión anterior de la app: correr ANTES de actualizar los dispositivos.

create table if not exists staff_schedules (
  id                uuid primary key,
  store_id          uuid not null references stores (id),
  user_id           uuid references users (id),
  name              text not null check (length(trim(name)) > 0),
  pay_period        text not null check (pay_period in ('weekly', 'biweekly', 'monthly')),
  -- 7 listas de turnos, de lunes a domingo: [[{"start":"08:00","end":"14:00"}], ...]
  days              jsonb not null,
  notes             text,
  created_at        timestamptz not null,
  updated_at        timestamptz not null,
  deleted_at        timestamptz,
  version           integer not null default 1,
  updated_by_device uuid not null,
  server_seq        bigint not null,
  server_updated_at timestamptz not null default now()
);
create index if not exists staff_schedules_store_idx on staff_schedules (store_id);
create index if not exists staff_schedules_server_seq_idx on staff_schedules (server_seq);
drop trigger if exists staff_schedules_sync on staff_schedules;
create trigger staff_schedules_sync before insert or update on staff_schedules for each row execute function tg_sync_stamp();
alter table staff_schedules enable row level security;
revoke all on table staff_schedules from anon, authenticated;

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

  if p_table in ('stock_movements', 'sale_items', 'payments', 'product_cost_history', 'account_movements', 'purchase_items', 'cash_movements', 'product_changes') then
    -- Sin conflictos posibles: id único y filas inmutables. Reenviar no duplica.
    execute format('insert into %I (%s) select %s from jsonb_populate_record(null::%I, $1) on conflict (id) do nothing', p_table, cols, cols, p_table) using p;
    get diagnostics n = row_count;
    return case when n > 0 then 'applied' else 'duplicate' end::sync_result;
  end if;

  if p_table not in ('stores', 'users', 'categories', 'products', 'barcodes', 'suppliers', 'purchases', 'employee_accounts', 'sales', 'cash_sessions', 'staff_schedules') then
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

