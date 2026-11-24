-- RED MINI POS · 0026 · Turnos de los locales y rotación mañana/noche.
-- stores.shift_hours: horario de los turnos mañana y noche de cada día (lunes a domingo).
-- staff_schedules.rotation: si la persona hace el turno mañana o noche del local, qué días,
-- y si cambia de turno cada semana. Los horarios se ven en todas las sucursales.
-- Es compatible con la versión anterior de la app: correr ANTES de actualizar los dispositivos.

alter table stores add column if not exists shift_hours jsonb;
alter table staff_schedules add column if not exists rotation jsonb;
-- Cambios por fecha: feriados del local y cambios puntuales de cada persona.
alter table stores add column if not exists shift_overrides jsonb;
alter table staff_schedules add column if not exists overrides jsonb;

-- p_store: null = todo; con valor = el catálogo compartido y sólo lo de esa sucursal.
-- Las boletas, la mercadería a descargar y los horarios se comparten entre sucursales: van siempre.
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
      where server_seq > p_cursor
    union all select 'supplier_invoices', server_seq, to_jsonb(x) from supplier_invoices x
      where server_seq > p_cursor
    union all select 'screen_exits', server_seq, to_jsonb(x) from screen_exits x
      where server_seq > p_cursor and (p_store is null or store_id = p_store)
    union all select 'sale_returns', server_seq, to_jsonb(x) from sale_returns x
      where server_seq > p_cursor and (p_store is null or store_id = p_store)
    union all select 'task_templates', server_seq, to_jsonb(x) from task_templates x
      where server_seq > p_cursor and (p_store is null or store_id = p_store)
    union all select 'day_tasks', server_seq, to_jsonb(x) from day_tasks x
      where server_seq > p_cursor and (p_store is null or store_id = p_store)
    union all select 'task_assignments', server_seq, to_jsonb(x) from task_assignments x
      where server_seq > p_cursor and (p_store is null or store_id = p_store)
    union all select 'cash_promos', server_seq, to_jsonb(x) from cash_promos x
      where server_seq > p_cursor and (p_store is null or store_id = p_store)
    union all select 'product_promos', server_seq, to_jsonb(x) from product_promos x
      where server_seq > p_cursor and (p_store is null or store_id = p_store)
    union all select 'unload_items', server_seq, to_jsonb(x) from unload_items x where server_seq > p_cursor
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
