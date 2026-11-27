import type { IconName } from '@/components/ui/Icon';
import type { PermissionKey } from '@/services/permissions';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  permission: PermissionKey;
  /** Visible en la barra inferior del celular; las demás quedan en su menú "Más". */
  mobile?: boolean;
  /** En una PC de pantalla angosta pasa al menú "Más". */
  secondary?: boolean;
  stage?: number;
  /** Tecla que lleva a esta pantalla desde cualquier lado; se muestra en el botón. */
  hotkey?: 'F1' | 'F2' | 'F3' | 'F4';
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/inicio', label: 'Inicio', icon: 'dashboard', permission: 'reports.view', mobile: true },
  { to: '/vender', label: 'Vender', icon: 'pos', permission: 'sales.create', mobile: true, hotkey: 'F1' },
  { to: '/cuentas', label: 'Cuentas', icon: 'store', permission: 'accounts.manage', secondary: true },
  { to: '/escanear', label: 'Escanear', icon: 'scan', permission: 'products.edit', mobile: true },
  { to: '/productos', label: 'Productos', icon: 'products', permission: 'products.edit', mobile: true, hotkey: 'F2' },
  { to: '/inventario', label: 'Inventario', icon: 'inventory', permission: 'stock.adjust', hotkey: 'F3' },
  { to: '/compras', label: 'Compras', icon: 'purchases', permission: 'purchases.manage' },
  { to: '/mayorista', label: 'Mayorista', icon: 'truck', permission: 'wholesale.manage', secondary: true },
  { to: '/reportes', label: 'Reportes', icon: 'reports', permission: 'reports.view', secondary: true },
  { to: '/horarios', label: 'Horarios', icon: 'calendar', permission: 'schedules.manage', secondary: true },
  { to: '/usuarios', label: 'Usuarios', icon: 'store', permission: 'users.manage', secondary: true },
  { to: '/ajustes', label: 'Ajustes', icon: 'settings', permission: 'settings.manage', secondary: true },
  { to: '/corte', label: 'Corte', icon: 'cash', permission: 'cash.manage', hotkey: 'F4' },
];
