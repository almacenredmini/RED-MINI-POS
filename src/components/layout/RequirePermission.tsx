import { useEffect, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { ExitButton } from './ExitButton';
import { EmptyState } from '@/components/ui/Card';
import type { PermissionKey } from '@/services/permissions';
import { NAV_ITEMS } from './navigation';

function useFirstAllowedRoute(): string | null {
  const { can } = useAuth();
  return NAV_ITEMS.find((i) => can(i.permission))?.to ?? null;
}

/** Sin ninguna pantalla habilitada no hay adónde mandarlo: al menos tiene que poder salir. */
function NoAccess() {
  return (
    <EmptyState icon="alert" title="Tu usuario no tiene pantallas habilitadas">
      <p>Pedile al dueño que te habilite al menos Vender.</p>
      <ExitButton variant="secondary" />
    </EmptyState>
  );
}

/**
 * Una pantalla sin permiso nunca deja a nadie trabado: avisa y lo lleva a su primera pantalla permitida
 * (al cajero, Vender). Pasa, por ejemplo, cuando entra un cajero con la app abierta donde la dejó el dueño.
 */
function Denied() {
  const toast = useToast();
  const target = useFirstAllowedRoute();
  useEffect(() => {
    if (target) toast('No tenés permiso para entrar a esa pantalla', 'error');
  }, [target, toast]);
  return target ? <Navigate to={target} replace /> : <NoAccess />;
}

export function RequirePermission({ permission, children }: { permission: PermissionKey; children: ReactNode }) {
  const { can } = useAuth();
  return can(permission) ? <>{children}</> : <Denied />;
}

/** Inicio es el panel; quien no puede verlo (el cajero) entra directo a su primera pantalla permitida. */
export function HomeRoute({ children }: { children: ReactNode }) {
  const { can } = useAuth();
  const target = useFirstAllowedRoute();
  if (can('reports.view')) return <>{children}</>;
  return target ? <Navigate to={target} replace /> : <NoAccess />;
}
