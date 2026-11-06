import { createHashRouter } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { HomeRoute, RequirePermission } from '@/components/layout/RequirePermission';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Card';
import { DashboardPage } from '@/pages/DashboardPage';
import { ProductsPage } from '@/pages/ProductsPage';
import { ProductEditPage } from '@/pages/ProductEditPage';
import { ScanPage } from '@/pages/ScanPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { ComingSoonPage } from '@/pages/ComingSoonPage';
import { PosPage } from '@/pages/PosPage';
import { SalesPage } from '@/pages/SalesPage';
import { UsersPage } from '@/pages/UsersPage';
import { AccountsPage } from '@/pages/AccountsPage';
import { InventoryPage } from '@/pages/InventoryPage';
import { PurchaseEditPage } from '@/pages/PurchaseEditPage';
import { PurchasesPage } from '@/pages/PurchasesPage';

/**
 * HashRouter: GitHub Pages no permite reescribir rutas al index.html.
 * Con `#/ruta` el servidor siempre entrega index.html y el Service Worker lo sirve offline sin casos especiales.
 */
export const router = createHashRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomeRoute><DashboardPage /></HomeRoute> },
      { path: 'productos', element: <RequirePermission permission="products.edit"><ProductsPage /></RequirePermission> },
      { path: 'productos/nuevo', element: <RequirePermission permission="products.edit"><ProductEditPage /></RequirePermission> },
      { path: 'productos/:id', element: <RequirePermission permission="products.edit"><ProductEditPage /></RequirePermission> },
      { path: 'escanear', element: <RequirePermission permission="products.edit"><ScanPage /></RequirePermission> },
      { path: 'ajustes', element: <RequirePermission permission="settings.manage"><SettingsPage /></RequirePermission> },
      { path: 'usuarios', element: <RequirePermission permission="users.manage"><UsersPage /></RequirePermission> },
      { path: 'ventas', element: <RequirePermission permission="sales.void"><SalesPage /></RequirePermission> },
      { path: 'vender', element: <RequirePermission permission="sales.create"><PosPage /></RequirePermission> },
      { path: 'cuentas', element: <RequirePermission permission="accounts.manage"><AccountsPage /></RequirePermission> },
      { path: 'inventario', element: <RequirePermission permission="stock.adjust"><InventoryPage /></RequirePermission> },
      { path: 'compras', element: <RequirePermission permission="purchases.manage"><PurchasesPage /></RequirePermission> },
      { path: 'compras/nueva', element: <RequirePermission permission="purchases.manage"><PurchaseEditPage /></RequirePermission> },
      { path: 'compras/:id', element: <RequirePermission permission="purchases.manage"><PurchaseEditPage /></RequirePermission> },
      {
        path: 'reportes',
        element: <RequirePermission permission="reports.view"><ComingSoonPage title="Reportes" icon="reports" stage={5} features={['Rentabilidad', 'Más vendidos', 'Por horario', 'Por sucursal', 'Stock valorizado']} /></RequirePermission>,
      },
      {
        path: '*',
        element: (
          <EmptyState icon="alert" title="Página no encontrada">
            <ButtonLink to="/" variant="primary">Ir al inicio</ButtonLink>
          </EmptyState>
        ),
      },
    ],
  },
]);
