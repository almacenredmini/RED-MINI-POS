import type { User, UserRole } from '@/types/domain';

export const PERMISSIONS = [
  { key: 'sales.create', label: 'Vender', group: 'Ventas' },
  { key: 'sales.discount', label: 'Aplicar descuentos', group: 'Ventas' },
  { key: 'sales.void', label: 'Ver historial y anular ventas', group: 'Ventas' },
  { key: 'accounts.manage', label: 'Administrar cuentas de empleados', group: 'Ventas' },
  { key: 'products.edit', label: 'Crear y editar productos', group: 'Productos' },
  { key: 'products.edit_price', label: 'Modificar precios', group: 'Productos' },
  { key: 'products.view_cost', label: 'Ver costos y márgenes', group: 'Productos' },
  { key: 'stock.adjust', label: 'Entradas, salidas, ajustes e importación', group: 'Inventario y compras' },
  { key: 'stock.transfer', label: 'Transferencias entre sucursales', group: 'Inventario y compras' },
  { key: 'purchases.manage', label: 'Compras y proveedores', group: 'Inventario y compras' },
  { key: 'reports.view', label: 'Ver panel de inicio y reportes', group: 'Administración' },
  { key: 'settings.manage', label: 'Ajustes de este dispositivo', group: 'Administración' },
  { key: 'users.manage', label: 'Administrar usuarios', group: 'Administración' },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

const ROLE_DEFAULTS: Record<Exclude<UserRole, 'owner'>, readonly PermissionKey[]> = {
  employee: ['sales.create'],
  manager: [
    'sales.create',
    'sales.discount',
    'sales.void',
    'accounts.manage',
    'products.edit',
    'products.edit_price',
    'products.view_cost',
    'stock.adjust',
    'stock.transfer',
    'purchases.manage',
    'reports.view',
    'settings.manage',
  ],
};

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Dueño',
  manager: 'Encargado',
  employee: 'Empleado',
};

export function roleGrants(role: UserRole, key: PermissionKey): boolean {
  return role === 'owner' || ROLE_DEFAULTS[role].includes(key);
}

/** El dueño tiene todo y no admite excepciones: así nadie puede quedar afuera del sistema. */
export function hasPermission(user: Pick<User, 'role' | 'permissions' | 'active'>, key: PermissionKey): boolean {
  if (!user.active) return false;
  if (user.role === 'owner') return true;
  return user.permissions[key] ?? roleGrants(user.role, key);
}
