import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '@/contexts/AuthContext';
import { getOpenSession } from '@/database/repositories/cash';
import { CloseCashModal } from '@/components/cash/CashModals';
import type { CashSession } from '@/types/domain';
import { Button } from '@/components/ui/Button';

/**
 * Un solo botón "Salir".
 * - Si la caja abierta es de quien sale: cierra su turno (conteo a ciegas) o lo deja abierto y sale.
 * - Si la caja es de otro (entró un administrador o encargado): sale sin tocarla.
 * Con una caja abierta, lo que se venda en el dispositivo entra en esa caja, la venda quien la venda,
 * y sólo pueden entrar su cajero, el dueño o un encargado (ver `login`).
 */
export function ExitButton({ variant = 'ghost' }: { variant?: 'ghost' | 'secondary' }) {
  const { user, logout } = useAuth();
  const open = useLiveQuery(() => getOpenSession(), []);
  // Se guarda la caja que se cierra: al cerrarse deja de ser "la abierta" y el resultado tiene que seguir a la vista.
  const [closing, setClosing] = useState<CashSession | null>(null);
  if (!user) return null;

  const mine = open !== undefined && open.opened_by === user.id;

  return (
    <>
      <Button size="sm" variant={variant} onClick={() => (mine ? setClosing(open) : logout())}>
        Salir
      </Button>
      {closing && (
        <CloseCashModal
          session={closing}
          exitAfter
          onHandOver={() => {
            setClosing(null);
            logout();
          }}
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
