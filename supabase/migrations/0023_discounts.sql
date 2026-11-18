-- RED MINI POS · 0023 · Descuentos (reemplaza a la promo de efectivo).
-- Cada descuento de cash_promos ahora dice:
--   methods: con qué formas de pago vale ('cash', 'card', 'transfer').
--   category_mode: 'all' = todo, 'only' = sólo las categorías de category_ids, 'except' = todo menos esas.
-- Las promos de efectivo que ya existen pasan tal cual: efectivo, y "todo menos" las categorías que excluían.
-- Es compatible con la versión anterior de la app: correr ANTES de actualizar los dispositivos.

alter table cash_promos add column if not exists methods text[] not null default '{cash}';
alter table cash_promos add column if not exists category_mode text not null default 'all';
alter table cash_promos add column if not exists category_ids uuid[] not null default '{}';

-- Pasar las exclusiones viejas al formato nuevo (una sola vez: sólo filas que todavía no lo tienen).
update cash_promos
   set category_mode = 'except', category_ids = excluded_category_ids
 where category_mode = 'all' and cardinality(category_ids) = 0 and cardinality(excluded_category_ids) > 0;
