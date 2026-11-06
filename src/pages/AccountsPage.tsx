import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrentStore } from '@/contexts/DeviceContext';
import { useToast } from '@/contexts/ToastContext';
import { db } from '@/database/db';
import { AccountError, listAccountMovements, listAccounts, saveAccount, settleAccount, type AccountWithBalance } from '@/database/repositories/accounts';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { centsToInput, formatMoney, parseMoney } from '@/services/money';
import type { AccountMovement } from '@/types/domain';
import inv from '@/components/inventory/Inventory.module.css';

const MOVEMENT_LABELS: Record<AccountMovement['type'], string> = {
  charge: 'Compra',
  charge_void: 'Compra anulada',
  settlement: 'Descontado del sueldo',
};

function AccountFormModal({ account, onClose }: { account: AccountWithBalance | null; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(account?.name ?? '');
  const [limit, setLimit] = useState(account ? centsToInput(account.limit_cents) : '');
  const [active, setActive] = useState(account?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const limitCents = parseMoney(limit);
    if (limitCents === null) return setError('Ingresá el límite');
    try {
      await saveAccount({ name, limit_cents: limitCents, active }, account?.id);
      toast('Cuenta guardada', 'success');
      onClose();
    } catch (e) {
      setError(e instanceof AccountError ? e.message : 'No se pudo guardar la cuenta');
    }
  };

  return (
    <Modal
      open
      title={account ? `Editar ${account.name}` : 'Nueva cuenta'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={() => void save()}>Guardar</Button>
        </>
      }
    >
      <div className={inv.form}>
        <Field label="Empleado">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" data-autofocus />}</Field>
        <Field label="Límite" hint="Tope de lo que puede acumular hasta el próximo descuento.">
          {(id) => <Input id={id} prefix="$" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} autoComplete="off" />}
        </Field>
        <label className={inv.check}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Cuenta activa
        </label>
        {error && <p className={inv.error} role="alert">{error}</p>}
      </div>
    </Modal>
  );
}

function AccountDetailModal({ account, onEdit, onClose }: { account: AccountWithBalance; onEdit: () => void; onClose: () => void }) {
  const store = useCurrentStore();
  const { user } = useAuth();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const movements = useLiveQuery(() => listAccountMovements(account.id), [account.id], []);
  const items = useLiveQuery(
    async () => {
      const saleIds = movements.flatMap((m) => (m.sale_id ? [m.sale_id] : []));
      const rows = await db.sale_items.where('sale_id').anyOf(saleIds).toArray();
      const bySale = new Map<string, string[]>();
      for (const r of rows) bySale.set(r.sale_id, [...(bySale.get(r.sale_id) ?? []), `${r.quantity} × ${r.description}`]);
      return bySale;
    },
    [movements],
    new Map<string, string[]>(),
  );

  const settle = async () => {
    try {
      const amount = await settleAccount(account.id, store.id, user?.id ?? null);
      toast(`${account.name}: ${formatMoney(amount)} descontados del sueldo`, 'success');
      onClose();
    } catch (e) {
      toast(e instanceof AccountError ? e.message : 'No se pudo registrar el descuento', 'error');
      setConfirming(false);
    }
  };

  return (
    <Modal
      open
      title={account.name}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onEdit}>Editar</Button>
          {confirming ? (
            <Button variant="primary" onClick={() => void settle()}>Confirmar {formatMoney(account.balance_cents)}</Button>
          ) : (
            <Button variant="primary" disabled={account.balance_cents <= 0} onClick={() => setConfirming(true)}>Descontar del sueldo</Button>
          )}
        </>
      }
    >
      <div className={inv.form}>
        <div className={inv.stats}>
          <div>
            <span className="muted">Debe</span>
            <p className={`num ${inv.big}`}>{formatMoney(account.balance_cents)}</p>
          </div>
          <div>
            <span className="muted">Disponible</span>
            <p className={`num ${inv.big}`}>{formatMoney(Math.max(0, account.available_cents))}</p>
          </div>
        </div>
        {movements.length === 0 ? (
          <p className="muted">Todavía no tiene movimientos.</p>
        ) : (
          <ul className={inv.previewList}>
            {movements.map((m) => (
              <li key={m.id}>
                <span className={inv.previewName}>
                  <strong>{MOVEMENT_LABELS[m.type]}</strong>
                  <span className="muted num">{new Date(m.occurred_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                  {m.sale_id && items.get(m.sale_id) && <span className="muted">{items.get(m.sale_id)?.join(', ')}</span>}
                </span>
                <span className={`num ${m.amount_cents > 0 ? inv.negative : inv.positive}`}>{formatMoney(m.amount_cents)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

export function AccountsPage() {
  const accounts = useLiveQuery(listAccounts, [], []);
  const [openId, setOpenId] = useState<string | null>(null);
  // undefined = cerrado, null = cuenta nueva.
  const [editing, setEditing] = useState<AccountWithBalance | null | undefined>(undefined);
  const open = accounts.find((a) => a.id === openId);

  return (
    <>
      <PageHeader
        title="Cuentas de empleados"
        subtitle="Lo que cada empleado saca para descontar del sueldo"
        actions={<Button variant="primary" icon="plus" onClick={() => setEditing(null)}>Nueva cuenta</Button>}
      />
      <Card className={inv.table}>
        {accounts.length === 0 ? (
          <EmptyState icon="store" title="Todavía no hay cuentas" />
        ) : (
          accounts.map((a) => (
            <button key={a.id} type="button" className={inv.row} onClick={() => setOpenId(a.id)}>
              <span className={inv.rowMain}>
                <strong>{a.name}</strong>
                <span className="muted num">Límite {formatMoney(a.limit_cents)}</span>
              </span>
              <span className={`${inv.rowEnd} num`}>
                {formatMoney(a.balance_cents)}
                {!a.active && <Badge>Inactiva</Badge>}
              </span>
            </button>
          ))
        )}
      </Card>
      {open && editing === undefined && (
        <AccountDetailModal
          key={open.id}
          account={open}
          onClose={() => setOpenId(null)}
          onEdit={() => {
            setEditing(open);
          }}
        />
      )}
      {editing !== undefined && <AccountFormModal key={editing?.id ?? 'new'} account={editing} onClose={() => setEditing(undefined)} />}
    </>
  );
}
