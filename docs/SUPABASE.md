# Conectar RED MINI POS con Supabase

Se hace una sola vez. El plan gratuito alcanza.

## 1. Crear el proyecto

1. Entrá a [supabase.com](https://supabase.com) y creá una cuenta gratuita.
2. Tocá **New project**. Elegí un nombre, una contraseña para la base de datos (guardala) y la región más cercana, por ejemplo São Paulo.
3. Esperá a que termine de crearse.

## 2. Crear las tablas

1. En Supabase, abrí **SQL Editor** y tocá **New query**.
2. Pegá todo el contenido de `supabase/setup.sql` y tocá **Run**.
3. Tiene que terminar sin errores.

## 3. Crear la cuenta de sincronización

1. Abrí **Authentication → Users** y tocá **Add user → Create new user**.
2. Poné un correo y una contraseña, y marcá **Auto Confirm User**.
3. Volvé al **SQL Editor** y autorizá ese correo, en minúsculas:

```sql
insert into sync_members (email) values ('tu-correo@ejemplo.com');
```

Esta cuenta es de los dispositivos. No es la misma que `admin`, que es el usuario del sistema en el local.

## 4. Cerrar el registro público

Abrí **Authentication → Sign In / Providers** y desactivá **Allow new users to sign up**.

Aunque alguien se registrara, no podría sincronizar si su correo no está en `sync_members`.

## 5. Copiar los datos de conexión

En **Project Settings → API** copiá:

- **Project URL**
- La clave **anon public**

No uses ni copies nunca la clave **service_role**: esa sí da acceso total.

## 6. Vincular cada dispositivo

En RED MINI POS, entrá a **Ajustes → Sincronización**, completá los datos y elegí qué guarda el dispositivo:

| Dispositivo | Qué elegir |
|---|---|
| PC de Oroño | PC de Oroño |
| PC de Uriburu | PC de Uriburu |
| Tu celular | Celular del dueño: todas las sucursales |

Para no tipear en el celular, en un dispositivo ya vinculado tocá **Copiar código de vinculación** y pegalo en el otro. La contraseña sí hay que escribirla.

## Recomendaciones

- **Vinculá primero el dispositivo con los productos cargados.** Sus cambios suben primero, y los demás los reciben al vincularse.
- **Pausa del plan gratuito:** Supabase pausa los proyectos sin actividad por varios días. Con uso diario no debería pasar. Si pasa, reactivalo desde su panel: las ventas siguen funcionando mientras tanto y se envían después.
- **Cambiar de proveedor:** las PC sólo tienen los datos de su sucursal, así que para migrar hay que copiar la base de Supabase al proveedor nuevo con un respaldo de PostgreSQL y ejecutar ahí las mismas migraciones.

## Probar sin cuenta

`npm run supabase:mock` levanta un servidor local que imita a Supabase, con PostgreSQL real y datos en memoria. Datos para vincular:

- Dirección: `http://localhost:54399`
- Clave: `mock`
- Correo: `dueno@redmini.test`
- Contraseña: `prueba`
