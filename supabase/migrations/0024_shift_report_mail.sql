-- RED MINI POS · 0024 · Mail del corte de turno.
-- Al cerrar una caja (Salir → Cerrar caja), el dispositivo sube a shift_reports el corte ya armado (asunto + HTML).
-- Cuando la fila llega acá, un trigger la manda por mail con Resend (https://resend.com) usando pg_net.
-- Si no hay Internet al cerrar, la fila espera en la cola del dispositivo y el mail sale cuando se sincroniza.
--
-- La clave de Resend y el mail de destino NO están en este archivo: se guardan en el Vault de Supabase.
--   select vault.create_secret('re_...', 'resend_api_key');
--   select vault.create_secret('tu-mail@ejemplo.com', 'corte_mail_to');
-- Sin esos dos secretos no se manda nada (y la sincronización sigue igual).
-- Para ver si Resend aceptó los envíos: select id, status_code, content from net._http_response order by id desc limit 5;

-- En Supabase existe; en la base de pruebas no: ahí la tabla funciona igual y simplemente no se manda nada.
do $$ begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net no disponible: %', sqlerrm;
end $$;

create table if not exists shift_reports (
  id              uuid primary key,
  store_id        uuid not null,
  cash_session_id uuid not null,
  subject         text not null,
  html            text not null,
  created_at      timestamptz not null default now(),
  -- Pedido de pg_net con el que salió el mail (null = no se mandó: faltan los secretos o falló).
  request_id      bigint
);
create index if not exists shift_reports_session_idx on shift_reports (cash_session_id);
alter table shift_reports enable row level security;
revoke all on table shift_reports from anon, authenticated;

create or replace function shift_reports_send() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  api_key text;
  mail_to text;
begin
  select decrypted_secret into api_key from vault.decrypted_secrets where name = 'resend_api_key';
  select decrypted_secret into mail_to from vault.decrypted_secrets where name = 'corte_mail_to';
  if api_key is null or mail_to is null then
    return new;
  end if;
  select net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', 'RED MINI POS <onboarding@resend.dev>',
      'to', jsonb_build_array(mail_to),
      'subject', new.subject,
      'html', new.html
    ),
    timeout_milliseconds := 10000
  ) into new.request_id;
  return new;
exception when others then
  -- El mail nunca puede trabar la sincronización.
  raise warning 'No se pudo mandar el mail del corte: %', sqlerrm;
  return new;
end $$;

drop trigger if exists shift_reports_send on shift_reports;
create trigger shift_reports_send before insert on shift_reports for each row execute function shift_reports_send();

-- shift_reports se suma a las tablas inmutables (sólo se insertan; reenviar no duplica).
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

  if p_table in ('stock_movements', 'sale_items', 'payments', 'product_cost_history', 'account_movements', 'purchase_items', 'cash_movements', 'product_changes', 'screen_exits', 'sale_returns', 'shift_reports') then
    -- Sin conflictos posibles: id único y filas inmutables. Reenviar no duplica.
    execute format('insert into %I (%s) select %s from jsonb_populate_record(null::%I, $1) on conflict (id) do nothing', p_table, cols, cols, p_table) using p;
    get diagnostics n = row_count;
    return case when n > 0 then 'applied' else 'duplicate' end::sync_result;
  end if;

  if p_table not in ('stores', 'users', 'categories', 'products', 'barcodes', 'suppliers', 'purchases', 'employee_accounts', 'sales', 'cash_sessions', 'staff_schedules', 'supplier_invoices', 'task_templates', 'day_tasks', 'task_assignments', 'cash_promos', 'product_promos') then
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
