import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCurrentStore } from '@/contexts/DeviceContext';
import { db } from '@/database/db';
import { dayRange, listSales } from '@/database/repositories/sales';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { formatMoney } from '@/services/money';
import { TicketDetail } from './TicketDetail';
import styles from './Sales.module.css';

export const toInputDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const time = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

/** "Ventas del día y devoluciones" desde la pantalla de venta: tickets del día, filtro por fecha y cajero. */
export function DayTicketsModal({ onClose }: { onClose: () => void }) {
  const store = useCurrentStore();
  const [date, setDate] = useState(() => toInputDate(new Date()));
  const [cashier, setCashier] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const data = useLiveQuery(
    async () => {
      const [from, to] = dayRange(new Date(`${date}T00:00:00`));
      const sales = await listSales(store.id, from, to);
      const returned = new Set((await db.sale_returns.where('sale_id').anyOf(sales.map((s) => s.id)).toArray()).map((r) => r.sale_id));
      const users = await db.users.bulkGet([...new Set(sales.map((s) => s.user_id).filter((x): x is string => !!x))]);
      return { sales, returned, users: users.filter((u) => !!u).map((u) => ({ id: u!.id, name: u!.name })) };
    },
    [store.id, date],
  );

  const open = data?.sales.find((s) => s.id === openId);
  const shown = (data?.sales ?? []).filter((s) => !cashier || s.user_id === cashier);
  const names = new Map(data?.users.map((u) => [u.id, u.name]));
  const total = shown.filter((s) => s.status === 'completed').reduce((t, s) => t + s.total_cents, 0);

  return (
    <Modal
      open
      title={open ? `Ticket ${open.number}` : 'Ventas del día y devoluciones'}
      onClose={onClose}
      footer={
        open ? (
          <Button icon="back" onClick={() => setOpenId(null)}>
            Volver a la lista
          </Button>
        ) : (
          <div className={styles.filters}>
            <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Día" />
            <Select value={cashier} onChange={(e) => setCashier(e.target.value)} aria-label="Cajero">
              <option value="">Todos los cajeros</option>
              {data?.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </div>
        )
      }
    >
      {open ? (
        <TicketDetail saleId={open.id} />
      ) : !data ? null : shown.length === 0 ? (
        <EmptyState icon="purchases" title="No hay tickets ese día" />
      ) : (
        <>
          <p className="muted">
            {shown.length} {shown.length === 1 ? 'ticket' : 'tickets'} · <span className="num">{formatMoney(total)}</span> sin contar devoluciones
          </p>
          <div className={styles.tickets}>
            {shown.map((s) => (
              <button key={s.id} type="button" className={styles.row} onClick={() => setOpenId(s.id)}>
                <span className={styles.main}>
                  <strong className="num">{s.number}</strong>
                  <span className="muted num">
                    {time(s.occurred_at)}
                    {s.user_id && ` · ${names.get(s.user_id) ?? 'Usuario borrado'}`}
                  </span>
                </span>
                {s.status === 'voided' && <Badge tone="danger">Cancelado</Badge>}
                {data.returned.has(s.id) && <Badge tone="warning">Con devolución</Badge>}
                <strong className={`num ${s.status === 'voided' ? styles.struck : ''}`}>{formatMoney(s.total_cents)}</strong>
              </button>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
