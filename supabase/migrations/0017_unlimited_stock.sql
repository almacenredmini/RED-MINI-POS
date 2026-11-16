-- RED MINI POS · 0017 · Productos con stock ilimitado.
-- track_stock = false: el producto no descuenta stock al vender, no avisa faltantes y no suma al valor del inventario.
-- (El producto común de la venta no necesita cambios: sale_items ya admite ítems sin producto.)
-- Es compatible con la versión anterior de la app: correr ANTES de actualizar los dispositivos.

alter table products add column if not exists track_stock boolean not null default true;
