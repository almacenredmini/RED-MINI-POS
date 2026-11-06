# RED MINI POS

Punto de venta offline-first para RED MINI (Oroño · Uriburu). Reemplazo de Eleventa 6.

- Funciona 100% sin Internet (PWA + IndexedDB).
- Preparado para N sucursales y N dispositivos por sucursal.
- Costo mensual: $0 (GitHub Pages + Supabase Free opcional).
- Cambiá la contraseña del usuario inicial desde **Usuarios** antes de usarlo en el local.

## Desarrollo

```bash
npm install
npm run dev        # http://localhost:5173/RED-MINI-POS/
npm test
npm run build
```

La cámara requiere HTTPS o `localhost`. Para probar desde el celular, usá la versión publicada en GitHub Pages.

## Despliegue

Push a `main` → GitHub Actions compila y publica en GitHub Pages (`.github/workflows/deploy.yml`).
En el repo: *Settings → Pages → Source: GitHub Actions*.

## Estructura

```
src/
  components/   ui/ (primitivas), layout/ (shell, navegación), products/
  pages/        una por ruta
  database/     Dexie (db.ts), outbox, seed, repositories/
  services/     lógica pura: dinero, ids, búsqueda, imágenes, tema
  scanner/      cámara (ZXing) y lector USB
  hooks/  contexts/  types/  styles/
supabase/migrations/   esquema PostgreSQL completo
docs/ARCHITECTURE.md   decisiones técnicas
```

## Etapas

1. ✅ Base: proyecto, navegación, tema, PWA, IndexedDB, productos.
2. ✅ Punto de venta, login y usuarios con permisos (en revisión).
3. ✅ Inventario, importación de Excel y compras (en revisión).
4. ✅ Sincronización y Supabase (falta probar con un proyecto real; ver `docs/SUPABASE.md`).
5. Reportes y optimizaciones.
