import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { EmptyState } from '@/components/ui/Card';
import type { PermissionKey } from '@/services/permissions';
import { NAV_ITEMS } from './navigation';

export function RequirePermission({ permission, children }: { permission: PermissionKey; children: ReactNode }) {
  const { can } = useAuth();
  if (can(permission)) return <>{children}</>;
  return <EmptyState icon="alert" title="No tenés permiso para ver esta pantalla" />;
}

/** Inicio es el panel; quien no puede verlo (el empleado) entra directo a su primera pantalla permitida. */
export function HomeRoute({ children }: { children: ReactNode }) {
  const { can } = useAuth();
  if (can('reports.view')) return <>{children}</>;
  const first = NAV_ITEMS.find((i) => can(i.permission));
  return first ? <Navigate to={first.to} replace /> : <EmptyState icon="alert" title="Tu usuario no tiene pantallas habilitadas" />;
}
