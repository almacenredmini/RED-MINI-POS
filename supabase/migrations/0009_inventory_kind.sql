-- RED MINI POS · 0009 · Distingue entrada, salida y conteo dentro de los movimientos de tipo adjustment.

alter table stock_movements add column kind text check (kind in ('entry', 'exit', 'count'));
