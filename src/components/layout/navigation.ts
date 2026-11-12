import type { IconName } from '@/components/ui/Icon';
import type { PermissionKey } from '@/services/permissions';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  permission: PermissionKey;
  /** Visible en la barra inferior del celular. */
  mobile?: boolean;
  /** En una PC de pantalla angosta pasa al menú "Más". */
  secondary?: boolean;
  stage?: number;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Inicio', icon: 'dashboard', permission: 'reports.view', mobile: true },
  { to: '/vender', label: 'Vender', icon: 'pos', permission: 'sales.create', mobile: true },
  { to: '/ventas', label: 'Ventas', icon: 'purchases', permission: 'sales.void' },
  { to: '/cuentas', label: 'Cuentas', icon: 'store', permission: 'accounts.manage' },
  { to: '/escanear', label: 'Escanear', icon: 'scan', permission: 'products.edit', mobile: true },
  { to: '/productos', label: 'Productos', icon: 'products', permission: 'products.edit', mobile: true },
  { to: '/inventario', label: 'Inventario', icon: 'inventory', permission: 'stock.adjust' },
  { to: '/compras', label: 'Compras', icon: 'purchases', permission: 'purchases.manage' },
  { to: '/reportes', label: 'Reportes', icon: 'reports', permission: 'reports.view', stage: 5, secondary: true },
  { to: '/usuarios', label: 'Usuarios', icon: 'store', permission: 'users.manage', secondary: true },
  { to: '/ajustes', label: 'Ajustes', icon: 'settings', permission: 'settings.manage', mobile: true, secondary: true },
];
