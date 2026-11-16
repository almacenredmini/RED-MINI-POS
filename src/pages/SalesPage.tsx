import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCurrentStore } from '@/contexts/DeviceContext';
import { db } from '@/database/db';
import { dayRange, listSales } from '@/database/repositories/sales';
import { Badge } from '@/components/ui/Badge';
import { Card, EmptyState } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { TicketDetail } from '@/components/sales/TicketDetail';
import { formatMoney } from '@/services/money';
import styles from './SalesPage.module.css';

const toInputDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function SaleModal({ saleId, onClose }: { saleId: string; onClose: () => void }) {
  const number = useLiveQuery(async () => (await db.sales.get(saleId))?.number, [saleId]);
  return (
    <Modal open title={`Ticket ${number ?? ''}`} onClose={onClose}>
      <TicketDetail saleId={saleId} />
    </Modal>
  );
}

export function SalesPage() {
  const store = useCurrentStore();
  const [date, setDate] = useState(() => toInputDate(new Date()));
  const [openId, setOpenId] = useState<string | null>(null);

  const sales = useLiveQuery(() => {
    const [from, to] = dayRange(new Date(`${date}T00:00:00`));
    return listSales(store.id, from, to);
  }, [store.id, date], []);

  return (
    <>
      <PageHeader
        title="Ventas"
        subtitle={`Sucursal ${store.name}`}
        actions={<Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Fecha" />}
      />
      <Card className={styles.list}>
        {sales.length === 0 ? (
          <EmptyState icon="purchases" title="No hay ventas en esta fecha" />
        ) : (
          sales.map((s) => (
            <button key={s.id} type="button" className={styles.row} onClick={() => setOpenId(s.id)}>
              <span className={styles.main}>
                <strong className="num">{s.number}</strong>
                <span className="muted num">{new Date(s.occurred_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</span>
              </span>
              {s.status === 'voided' && <Badge tone="danger">Cancelado</Badge>}
              <strong className={`num ${s.status === 'voided' ? styles.struck : ''}`}>{formatMoney(s.total_cents)}</strong>
            </button>
          ))
        )}
      </Card>
      {openId && <SaleModal saleId={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}
