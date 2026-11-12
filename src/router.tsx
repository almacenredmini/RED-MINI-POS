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
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const ReportsPage = lazy(() => import('@/pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const SalesPage = lazy(() => import('@/pages/SalesPage').then((m) => ({ default: m.SalesPage })));
const UsersPage = lazy(() => import('@/pages/UsersPage').then((m) => ({ default: m.UsersPage })));
const AccountsPage = lazy(() => import('@/pages/AccountsPage').then((m) => ({ default: m.AccountsPage })));
const InventoryPage = lazy(() => import('@/pages/InventoryPage').then((m) => ({ default: m.InventoryPage })));
const PurchaseEditPage = lazy(() => import('@/pages/PurchaseEditPage').then((m) => ({ default: m.PurchaseEditPage })));
const PurchasesPage = lazy(() => import('@/pages/PurchasesPage').then((m) => ({ default: m.PurchasesPage })));
const CashPage = lazy(() => import('@/pages/CashPage').then((m) => ({ default: m.CashPage })));

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
      { path: 'productos/nuevo', element: <RequirePermission permission="products.edit"><ProductEditPage /></RequirePermission> },
      { path: 'productos/:id', element: <RequirePermission permission="products.edit"><ProductEditPage /></RequirePermission> },
      { path: 'escanear', element: <RequirePermission permission="products.edit"><ScanPage /></RequirePermission> },
      { path: 'ajustes', element: <RequirePermission permission="settings.manage"><SettingsPage /></RequirePermission> },
      { path: 'usuarios', element: <RequirePermission permission="users.manage"><UsersPage /></RequirePermission> },
      { path: 'caja', element: <RequirePermission permission="sales.create"><CashPage /></RequirePermission> },
      { path: 'ventas', element: <RequirePermission permission="sales.void"><SalesPage /></RequirePermission> },
      { path: 'vender', element: <RequirePermission permission="sales.create"><PosPage /></RequirePermission> },
      { path: 'cuentas', element: <RequirePermission permission="accounts.manage"><AccountsPage /></RequirePermission> },
      { path: 'inventario', element: <RequirePermission permission="stock.adjust"><InventoryPage /></RequirePermission> },
      { path: 'compras', element: <RequirePermission permission="purchases.manage"><PurchasesPage /></RequirePermission> },
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
