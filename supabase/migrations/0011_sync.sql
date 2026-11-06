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
