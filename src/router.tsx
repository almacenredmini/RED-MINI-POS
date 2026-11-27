import { lazy } from 'react';
import { createHashRouter, Navigate } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { RequirePermission } from '@/components/layout/RequirePermission';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Card';
import { DashboardPage } from '@/pages/DashboardPage';
import { PosPage } from '@/pages/PosPage';

// Vender e Inicio van en el paquete principal; el resto se carga al abrirlo (igual queda guardado para usar sin Internet).
const ProductsPage = lazy(() => import('@/pages/ProductsPage').then((m) => ({ default: m.ProductsPage })));
const ProductEditPage = lazy(() => import('@/pages/ProductEditPage').then((m) => ({ default: m.ProductEditPage })));
const ScanPage = lazy(() => import('@/pages/ScanPage').then((m) => ({ default: m.ScanPage })));
const UnloadPage = lazy(() => import('@/pages/UnloadPage').then((m) => ({ default: m.UnloadPage })));
const PromotionsPage = lazy(() => import('@/pages/PromotionsPage').then((m) => ({ default: m.PromotionsPage })));
const DiscountsPage = lazy(() => import('@/pages/DiscountsPage').then((m) => ({ default: m.DiscountsPage })));
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const ReportsPage = lazy(() => import('@/pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const UsersPage = lazy(() => import('@/pages/UsersPage').then((m) => ({ default: m.UsersPage })));
const AccountsPage = lazy(() => import('@/pages/AccountsPage').then((m) => ({ default: m.AccountsPage })));
const InventoryPage = lazy(() => import('@/pages/InventoryPage').then((m) => ({ default: m.InventoryPage })));
const PurchaseEditPage = lazy(() => import('@/pages/PurchaseEditPage').then((m) => ({ default: m.PurchaseEditPage })));
const PurchasesPage = lazy(() => import('@/pages/PurchasesPage').then((m) => ({ default: m.PurchasesPage })));
const CashPage = lazy(() => import('@/pages/CashPage').then((m) => ({ default: m.CashPage })));
const SchedulesPage = lazy(() => import('@/pages/SchedulesPage').then((m) => ({ default: m.SchedulesPage })));
const WholesalePage = lazy(() => import('@/pages/WholesalePage').then((m) => ({ default: m.WholesalePage })));
const WholesaleEditPage = lazy(() => import('@/pages/WholesaleEditPage').then((m) => ({ default: m.WholesaleEditPage })));
const SupplierInvoicePage = lazy(() => import('@/pages/SupplierInvoicePage').then((m) => ({ default: m.SupplierInvoicePage })));

/**
 * HashRouter: GitHub Pages no permite reescribir rutas al index.html.
 * Con `#/ruta` el servidor siempre entrega index.html y el Service Worker lo sirve offline sin casos especiales.
 */
export const router = createHashRouter([
  {
    element: <AppShell />,
    children: [
      // Todos arrancan en Vender; quien no puede vender va a su primera pantalla permitida.
      { index: true, element: <Navigate to="/vender" replace /> },
      { path: 'inicio', element: <RequirePermission permission="reports.view"><DashboardPage /></RequirePermission> },
      { path: 'productos', element: <RequirePermission permission="products.edit"><ProductsPage /></RequirePermission> },
      { path: 'productos/promociones', element: <RequirePermission permission="products.edit_price"><PromotionsPage /></RequirePermission> },
      { path: 'productos/descuentos', element: <RequirePermission permission="sales.discount"><DiscountsPage /></RequirePermission> },
      { path: 'productos/nuevo', element: <RequirePermission permission="products.edit"><ProductEditPage /></RequirePermission> },
      { path: 'productos/:id', element: <RequirePermission permission="products.edit"><ProductEditPage /></RequirePermission> },
      { path: 'escanear', element: <RequirePermission permission="products.edit"><ScanPage /></RequirePermission> },
      { path: 'ajustes', element: <RequirePermission permission="settings.manage"><SettingsPage /></RequirePermission> },
      { path: 'usuarios', element: <RequirePermission permission="users.manage"><UsersPage /></RequirePermission> },
      { path: 'corte', element: <RequirePermission permission="cash.manage"><CashPage /></RequirePermission> },
      { path: 'caja', element: <Navigate to="/corte" replace /> },
      { path: 'ventas', element: <Navigate to="/vender" replace /> },
      { path: 'vender', element: <RequirePermission permission="sales.create"><PosPage /></RequirePermission> },
      { path: 'horarios', element: <RequirePermission permission="schedules.manage"><SchedulesPage /></RequirePermission> },
      { path: 'mayorista', element: <RequirePermission permission="wholesale.manage"><WholesalePage /></RequirePermission> },
      { path: 'mayorista/nuevo', element: <RequirePermission permission="wholesale.manage"><WholesaleEditPage /></RequirePermission> },
      { path: 'mayorista/:id', element: <RequirePermission permission="wholesale.manage"><WholesaleEditPage /></RequirePermission> },
      { path: 'cuentas', element: <RequirePermission permission="accounts.manage"><AccountsPage /></RequirePermission> },
      { path: 'inventario/descargar', element: <RequirePermission permission="stock.adjust"><UnloadPage /></RequirePermission> },
      { path: 'inventario', element: <RequirePermission permission="stock.adjust"><InventoryPage /></RequirePermission> },
      { path: 'compras', element: <RequirePermission permission="purchases.manage"><PurchasesPage /></RequirePermission> },
      { path: 'compras/boletas/nueva', element: <RequirePermission permission="purchases.manage"><SupplierInvoicePage /></RequirePermission> },
      { path: 'compras/boletas/:id', element: <RequirePermission permission="purchases.manage"><SupplierInvoicePage /></RequirePermission> },
      { path: 'compras/nueva', element: <RequirePermission permission="purchases.manage"><PurchaseEditPage /></RequirePermission> },
      { path: 'compras/:id', element: <RequirePermission permission="purchases.manage"><PurchaseEditPage /></RequirePermission> },
      {
        path: 'reportes',
        element: <RequirePermission permission="reports.view"><ReportsPage /></RequirePermission>,
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
