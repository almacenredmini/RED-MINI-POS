# RED MINI POS — Requisitos por etapa

Requisitos acordados con el dueño que todavía no están implementados.

## Etapa 2 · Punto de venta (vista de empleado)

Pantalla simple, pensada sólo para vender rápido. Sin menús del administrador.

| Acción | Atajo |
|---|---|
| Buscar producto | **F10** |
| Sumar 1 unidad al ítem | botón **+** |
| Restar 1 unidad (en 0 se quita) | botón **−** |
| Vender (abre el cobro) | **F12** |
| Cerrar venta **e imprimir** ticket | **F1** |
| Cerrar venta **sin imprimir** | **F2** |

- El lector USB agrega el producto escaneado directamente al carrito, sin tener que buscarlo.
- El cobro ofrece 3 opciones: **Efectivo**, **Tarjeta** y **Mixto** (una parte en efectivo y otra con tarjeta).
- Hay un campo para cargar los montos. En efectivo se calcula el vuelto. En mixto, la parte con tarjeta se completa sola con lo que falta.
- La venta se confirma siempre de forma local, sin depender de Internet.

Notas técnicas:
- Las teclas F1, F10 y F12 tienen funciones propias en el navegador (Ayuda, menú, DevTools). La app las intercepta, y esto funciona de forma más confiable con la **PWA instalada** (ventana propia).
- Imprimir sin que aparezca el diálogo de impresión requiere abrir Chrome con `--kiosk-printing` en la PC del mostrador. El ticket se diseña para impresora térmica de 58 u 80 mm.
- Cuando existan usuarios (Etapa 5), esta es la vista del rol **Empleado**. Dueño y Encargado ven el panel completo.

## Etapa 3 · Inventario: importación masiva desde Eleventa

Botón **Importar Excel** con 5 columnas:

| Nombre | Código de barra | Cantidad | Precio costo | Precio de venta |
|---|---|---|---|---|

- Se acepta `.xlsx`, `.xls` y `.csv`. Las columnas se reconocen por su encabezado, sin importar mayúsculas ni acentos.
- Antes de confirmar se muestra una **vista previa** con lo que se va a crear, actualizar y los errores de cada fila (precio inválido, código duplicado dentro del archivo, etc.).
- Si el código ya existe, se actualizan el nombre y los precios. Si no existe, se crea el producto.
- La **Cantidad** genera un movimiento `initial` en la sucursal actual: nunca se escribe el stock directamente.
- Toda la importación se guarda en una sola transacción: o entra completa o no entra nada.
- Los precios se aceptan en formato argentino (`1.234,50`) o como número de Excel.
