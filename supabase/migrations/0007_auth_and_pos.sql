-- RED MINI POS · 0007 · Login por usuario y contraseña, y cobro genérico con tarjeta.

alter table users add column username text;
alter table users add column password_hash text;   -- pbkdf2$iteraciones$sal$hash
update users set username = lower(coalesce(email, id::text)) where username is null;
alter table users alter column username set not null;
alter table users add constraint users_username_uq unique (username);
alter table users add constraint users_username_lower check (username = lower(username));
alter table users drop column pin_hash;

-- Tarjeta sin distinguir débito/crédito (la vista de venta ofrece Efectivo, Tarjeta y Mixto).
alter type payment_method add value if not exists 'card';

insert into permissions (key, description) values ('settings.manage', 'Ajustes del dispositivo')
  on conflict (key) do nothing;
insert into role_permissions (role, permission_key) values ('manager', 'settings.manage')
  on conflict do nothing;
