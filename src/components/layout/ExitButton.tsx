import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '@/contexts/AuthContext';
import { getOpenSession } from '@/database/repositories/cash';
import { CloseCashModal } from '@/components/cash/CashModals';
import type { CashSession } from '@/types/domain';
import { Button } from '@/components/ui/Button';

/**
 * "Salir" cierra la caja de quien la abrió (con conteo a ciegas) y recién ahí cierra la sesión.
 * Quien tiene `cash.manage` puede además "Cambiar usuario": sale sin cerrar la caja, que sigue abierta
 * para el cajero (y lo que venda mientras tanto entra en esa caja).
 */
export function ExitButton({ variant = 'ghost' }: { variant?: 'ghost' | 'secondary' }) {
  const { user, can, logout } = useAuth();
  const open = useLiveQuery(() => getOpenSession(), []);
  // Se guarda la caja que se cierra: al cerrarse deja de ser "la abierta" y el resultado tiene que seguir a la vista.
  const [closing, setClosing] = useState<CashSession | null>(null);
  if (!user) return null;

  const mine = open !== undefined && open.opened_by === user.id;
  const canSwitch = open !== undefined && can('cash.manage');

  return (
    <>
      {canSwitch && (
        <Button size="sm" variant={variant} onClick={logout} title="Sale sin cerrar la caja">
          Cambiar usuario
        </Button>
      )}
      {(!open || mine || !canSwitch) && (
        <Button size="sm" variant={variant} onClick={() => (mine ? setClosing(open) : logout())}>
          Salir
        </Button>
      )}
      {closing && (
        <CloseCashModal
          session={closing}
          exitAfter
          onCancel={() => setClosing(null)}
          onClosed={() => {
            setClosing(null);
            logout();
          }}
        />
      )}
    </>
  );
}
