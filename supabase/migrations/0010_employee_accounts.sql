-- RED MINI POS · 0010 · Cuentas de empleados: lo que sacan para descontar del sueldo.

alter type payment_method add value if not exists 'employee_account';

create table employee_accounts (
  id                uuid primary key,
  name              text not null check (length(trim(name)) > 0),
  limit_cents       bigint not null check (limit_cents >= 0),
  active            boolean not null default true,
  created_at        timestamptz not null,
  updated_at        timestamptz not null,
  deleted_at        timestamptz,
  version           integer not null default 1,
  updated_by_device uuid not null,
  server_seq        bigint not null,
  server_updated_at timestamptz not null default now()
);
create index employee_accounts_server_seq_idx on employee_accounts (server_seq);
create trigger employee_accounts_sync before insert or update on employee_accounts for each row execute function tg_sync_stamp();

-- El saldo es la suma de los movimientos: positivo = compra, negativo = anulación o descuento del sueldo.
create table account_movements (
  id                uuid primary key,
  account_id        uuid not null references employee_accounts (id),
  type              text not null check (type in ('charge', 'charge_void', 'settlement')),
  amount_cents      bigint not null check (amount_cents <> 0),
  sale_id           uuid references sales (id),
  store_id          uuid not null references stores (id),
  user_id           uuid references users (id),
  device_id         uuid not null,
  note              text,
  occurred_at       timestamptz not null,
  server_seq        bigint not null,
  server_updated_at timestamptz not null default now(),
  check ((type = 'charge') = (amount_cents > 0))
);
create index account_movements_account_idx on account_movements (account_id, occurred_at desc);
create index account_movements_sale_idx on account_movements (sale_id);
create index account_movements_server_seq_idx on account_movements (server_seq);
create trigger account_movements_sync before insert on account_movements for each row execute function tg_sync_stamp();
create trigger account_movements_immutable before update or delete on account_movements for each row execute function tg_append_only();

alter table payments add column account_id uuid references employee_accounts (id);
create index payments_account_idx on payments (account_id);

insert into permissions (key, description) values ('accounts.manage', 'Administrar cuentas de empleados')
  on conflict (key) do nothing;
insert into role_permissions (role, permission_key) values ('manager', 'accounts.manage')
  on conflict do nothing;
