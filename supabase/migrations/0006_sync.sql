-- RED MINI POS · 0006 · Registro de sincronización (lado servidor).
-- Cada operación que llega de un dispositivo se registra con el MISMO id que tenía en su
-- `sync_queue` local. Reenviar una operación (por corte de red a mitad de respuesta) es
-- idempotente: el id ya existe y se responde OK sin aplicarla dos veces.

create type sync_op as enum ('upsert', 'delete');
create type sync_result as enum ('applied', 'duplicate', 'conflict_resolved', 'rejected');

create table sync_queue (
  id                uuid primary key,           -- = SyncQueueEntry.id del dispositivo
  device_id         uuid not null,
  store_id          uuid references stores (id),
  table_name        text not null,
  record_id         uuid not null,
  op                sync_op not null,
  payload           jsonb not null,
  client_version    integer,
  client_created_at timestamptz not null,
  received_at       timestamptz not null default now(),
  result            sync_result not null,
  detail            text                        -- motivo de rechazo / cómo se resolvió el conflicto
);
create index sync_queue_device_idx on sync_queue (device_id, received_at desc);
create index sync_queue_record_idx on sync_queue (table_name, record_id, received_at desc);
create index sync_queue_rejected_idx on sync_queue (received_at desc) where result in ('rejected', 'conflict_resolved');

-- Trazabilidad: el log es inmutable.
create trigger sync_queue_immutable before update or delete on sync_queue
  for each row execute function tg_append_only();

-- RLS: se activa en la Etapa 4 junto con Supabase Auth (políticas por sucursal y rol).
