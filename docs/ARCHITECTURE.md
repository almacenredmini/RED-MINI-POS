# RED MINI POS — Decisiones de arquitectura

Registro de decisiones (ADR). Cada una: opciones, ventajas/desventajas, elección.

## 1. Fuente de verdad: base local en cada dispositivo

| Opción | A favor | En contra |
|---|---|---|
| Servidor como fuente de verdad + caché | Simple de razonar | Sin Internet no se vende. Descartado por requisito. |
| **Local-first (IndexedDB) + sincronización** | Vende siempre; latencia 0; tolera cortes | Requiere diseño de sync y conflictos |

**Elegido: local-first.** La UI sólo lee/escribe Dexie. El servidor es una réplica y punto de encuentro entre dispositivos.

## 2. Identificadores: UUID v7 generado en el dispositivo

- Autoincremental del servidor: imposible offline (dos cajas generarían el mismo id).
- UUID v4: único pero aleatorio → fragmenta índices B-tree en PostgreSQL.
- **UUID v7**: único sin coordinación **y** ordenado por tiempo → inserciones al final del índice. Elegido.

Números de ticket legibles: `SUCURSAL-DISPOSITIVO-SECUENCIA` (`ORO-F757-000123`), donde el dispositivo son los últimos 4 caracteres de su id. Se generan sin coordinación, sin Internet.

## 3. Dinero: enteros en centavos

`0.1 + 0.2 !== 0.3` en JavaScript. Todo monto es `bigint` en SQL y entero en TS (`*_cents`). Formateo sólo en la UI.

## 4. Stock: proyección de movimientos (event sourcing acotado)

| Opción | A favor | En contra |
|---|---|---|
| Campo `stock` editable | Simple | Dos sucursales offline pisan valores; sin trazabilidad |
| **Movimientos append-only + proyección** | Sin conflictos (se suman deltas), auditoría total, recalculable | Un poco más de código |

**Elegido: movimientos.** En PostgreSQL lo garantizan triggers: `stock_movements` no admite UPDATE/DELETE, y `stock` sólo lo actualiza el trigger. Corregir = nuevo movimiento compensatorio.

## 5. Sincronización: Outbox + cursor por secuencia

- **Subida (push):** cada escritura local encola en `sync_queue` dentro de la **misma transacción** (patrón outbox). Si se guardó el dato, existe el evento. Reintentos idempotentes: el servidor registra el `id` de la operación y descarta duplicados.
- **Bajada (pull):** cada fila del servidor recibe `server_seq` (secuencia global). El dispositivo pide `server_seq > último_visto`. Sin problemas de relojes desincronizados.
- **Conflictos:**
  - Ventas, pagos, movimientos: inmutables con id único → **no hay conflictos posibles**.
  - Catálogo (productos, precios): *last-writer-wins* por `version` + `updated_at`, registrando en `sync_queue.detail` qué versión se descartó (trazabilidad).
  - Anulaciones: transición de estado única (`completed → voided`) validada por trigger.

Se evaluó CRDT (Automerge/Yjs): sobredimensionado para un POS cuyo dato crítico ya es append-only.

## 6. Backend: PostgreSQL estándar, Supabase como proveedor intercambiable

El esquema (`supabase/migrations`) es SQL puro; sólo `users.auth_user_id` refiere a Supabase Auth y es opcional. Migrar a Neon/Railway/servidor propio = ejecutar las mismas migraciones. La app habla con el backend a través de un único servicio de sync (Etapa 4), no desde los componentes.

## 7. Router: HashRouter

GitHub Pages no reescribe rutas: `/productos` recargado daría 404. Con `#/productos` siempre se sirve `index.html` y el Service Worker lo atiende offline sin configuración extra. Alternativa (truco `404.html`) es frágil con PWA.

## 8. Actualizaciones de la PWA: `prompt`, nunca automáticas

Una recarga automática en medio de una venta es inaceptable. Se avisa y el usuario elige cuándo.

## 9. Escáner

- **Lector USB/Bluetooth**: actúa como teclado. Se detecta por velocidad entre teclas (<40 ms) + Enter, sin necesidad de foco (`useKeyboardWedge`).
- **Cámara**: ZXing (`@zxing/browser`), carga diferida (sólo al abrir la cámara), formatos acotados (EAN/UPC/Code128/ITF/QR) para mayor velocidad, linterna si el equipo la soporta.

## 10. Estilos: CSS Modules + tokens

Sin runtime (vs. CSS-in-JS), sin dependencia de framework (vs. Tailwind), estilos aislados por componente y un único archivo de tokens (`styles/tokens.css`) para tema oscuro/claro.

## 11. Persistencia del almacenamiento

Se solicita `navigator.storage.persist()` al iniciar: sin eso el navegador puede borrar IndexedDB bajo presión de disco. Instalar la PWA aumenta la probabilidad de que se otorgue. Se muestra el estado en Ajustes.

## 12. Login local con PBKDF2

El usuario se valida incluso sin Internet, así que la validación ocurre en el dispositivo: la contraseña se guarda como hash PBKDF2 con sal, nunca en claro, y la sesión queda abierta en el dispositivo (sólo el id del usuario en localStorage) hasta que se toca "Salir"; si el usuario se desactiva, se cierra sola. El campo de contraseña no es de tipo password, para que el navegador no ofrezca guardarla en una PC compartida.

Límite conocido: esto ordena quién hace qué en el mostrador, pero no protege contra alguien con acceso técnico al navegador, que puede leer IndexedDB. La protección real de los datos en el servidor llega en la Etapa 4 con Supabase Auth y RLS.

## 13. Venta

- Venta, ítems, pagos, movimientos de stock y cola de sincronización se guardan en una sola transacción.
- El id de la venta se genera antes de confirmar: dos F1/F2 seguidos no pueden crear dos ventas.
- El stock puede quedar negativo: una diferencia de inventario nunca frena una venta.
- El carrito se guarda en la base local y sobrevive a una recarga o a un corte de luz.
- La impresión ocurre después de guardar: si la impresora falla, la venta ya está registrada.

## 14. Sucursal por usuario

`users.store_id` nulo permite moverse entre sucursales con el selector; con valor, el usuario queda fijo en esa. Un empleado siempre tiene una asignada. Al entrar un usuario fijo, la app cambia a su sucursal antes de mostrar cualquier pantalla, para que ninguna venta caiga en otra.

## 15. Stock mínimo automático

Cada lunes, al entrar a la sucursal, se recalcula por producto: promedio semanal de lo vendido en las últimas 4 semanas completas, redondeado para arriba, que equivale a cubrir 1 semana de venta (`WINDOW_WEEKS` y `COVER_WEEKS` en `repositories/minStock.ts`). No cuenta la semana en curso ni las ventas anuladas. El mínimo manual vale mientras el producto no tenga ventas, o siempre si se apaga el cálculo en su ficha.

Es un dato derivado de las ventas, por eso no pasa por `sync_queue`. Hasta la Etapa 4 cada dispositivo calcula sólo con sus propias ventas.

## 16. Inventario

- Entrada, salida y conteo se guardan como `adjustment` con `kind`. El conteo registra la diferencia con el stock actual.
- Una transferencia son dos movimientos con el mismo `transfer_id`, guardados en una sola transacción. Hasta la Etapa 4, la otra sucursal no los ve en sus dispositivos.
- Todo cambio de stock pasa por `applyStockMovement` o `applyStockMovements`.

## 17. Importación de Excel

La cantidad del archivo es el stock real de la sucursal actual: se registra la diferencia, así que importar dos veces el mismo archivo no duplica nada. Las filas con error se informan y quedan afuera; el resto entra en una sola transacción.

Librería: `xlsx` 0.18.5 de npm, cargada sólo al importar. Es la última versión en el registro y tiene vulnerabilidades conocidas al abrir archivos manipulados (CVE-2023-30533 y CVE-2024-22363). El riesgo es bajo porque sólo se abren archivos propios en el navegador, sin servidor. Las versiones corregidas se distribuyen desde cdn.sheetjs.com.

## 18. Compras

Un borrador no toca stock ni costos. Recibir suma stock, actualiza el costo del producto y registra el costo histórico en una sola transacción; el precio de venta nunca cambia solo. Una compra recibida no se puede modificar.

## 19. Cuentas de empleados

Cada cuenta tiene un límite que fija el dueño al crearla. El saldo no se guarda: es la suma de `account_movements`, igual que el stock. Comprar a cuenta no pide autorización y se puede cargar a cualquier cuenta; el usuario que la cargó queda registrado. Se cobra a precio de venta y no suma a la caja. Descontar del sueldo deja el saldo en cero y conserva el detalle.

El límite se controla dentro de la transacción de la venta. Hasta la Etapa 4, cada dispositivo sólo ve lo cargado en él.

## 20. Sincronización

El servidor es un buzón y un respaldo: cada dispositivo sigue funcionando solo. Las opciones evaluadas están en la conversación del proyecto: programa instalado en la PC (sin datos en la nube, pero un celular fuera del local no llega) y conexión directa entre dispositivos (ambos prendidos a la vez). Se eligió el buzón porque el dueño carga mercadería desde fuera del local.

- **Acceso:** ninguna tabla se lee ni escribe directamente. Sólo `sync_push` y `sync_pull`, con sesión iniciada y un correo en `sync_members`.
- **Subida:** la cola se envía en orden y cada cambio se aplica por separado. Uno rechazado queda como error en el dispositivo y no frena al resto.
- **Bajada:** por `server_seq`. `sync_push` toma un bloqueo para que los números crezcan en el mismo orden en que se confirman.
- **Conflictos:** en datos editables gana la versión más alta y, si empatan, el último cambio. Lo inmutable no puede entrar en conflicto. Un código de barras repetido queda como error visible.
- **Alcance:** la PC de un local baja el catálogo y sólo lo de su sucursal, y por eso no puede cambiar de sucursal. El celular del dueño baja todo.
- **Proveedor:** `SyncTransport` es lo único que conoce el motor. Se usa `fetch` directo, sin el SDK de Supabase.
- **Pruebas:** las migraciones y las funciones se ejecutan contra PostgreSQL real (PGlite) en `sync.test.ts`. La autenticación de Supabase está simulada.
