import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrentStore } from '@/contexts/DeviceContext';
import { useToast } from '@/contexts/ToastContext';
import { db } from '@/database/db';
import { dayRange, getSaleDetail, listSales, voidSale } from '@/database/repositories/sales';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatMoney } from '@/services/money';
import { PAYMENT_LABELS } from '@/services/payment';
import { printHtml, renderTicketHtml } from '@/services/ticket';
import styles from './SalesPage.module.css';

const toInputDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function SaleModal({ saleId, onClose }: { saleId: string; onClose: () => void }) {
  const store = useCurrentStore();
  const { user } = useAuth();
  const toast = useToast();
  const detail = useLiveQuery(() => getSaleDetail(saleId), [saleId]);
  const cashier = useLiveQuery(async () => (detail?.sale.user_id ? (await db.users.get(detail.sale.user_id))?.name : undefined), [detail?.sale.user_id]);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');

  if (!detail) return null;
  const { sale, items, payments } = detail;

  const confirmVoid = async () => {
    try {
      await voidSale(sale.id, user?.id ?? null, reason);
      toast(`Venta ${sale.number} anulada`, 'success');
      setVoiding(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo anular la venta', 'error');
    }
  };

  return (
    <Modal
      open
      title={`Ticket ${sale.number}`}
      onClose={onClose}
      footer={
        <>
          {sale.status === 'completed' && !voiding && (
            <Button variant="danger" onClick={() => setVoiding(true)}>
              Anular
            </Button>
          )}
          <Button icon="pos" onClick={() => printHtml(renderTicketHtml({ ...detail, storeName: store.name, cashier: cashier ?? null }))}>
            Reimprimir
          </Button>
        </>
      }
    >
      <div className={styles.detail}>
        {sale.status === 'voided' && (
          <p className={styles.voided}>
            Anulada: {sale.void_reason}
          </p>
        )}
        <ul className={styles.items}>
          {items.map((i) => (
            <li key={i.id}>
              <span>
                {i.quantity} × {i.description}
              </span>
              <span className="num">{formatMoney(i.total_cents)}</span>
            </li>
          ))}
        </ul>
        {sale.discount_cents > 0 && (
          <p className="muted num">
            Descuento: -{formatMoney(sale.discount_cents)}
          </p>
        )}
        <p className={`${styles.total} num`}>{formatMoney(sale.total_cents)}</p>
        <p className="muted">{payments.map((p) => `${PAYMENT_LABELS[p.method]} ${formatMoney(p.amount_cents)}`).join(' + ')}</p>
        {cashier && <p className="muted">Atendió: {cashier}</p>}
        {voiding && (
          <div className={styles.voidForm}>
            <Field label="Motivo de la anulación">
              {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus autoComplete="off" />}
            </Field>
            <p className="muted">El stock de estos productos vuelve a la sucursal.</p>
            <Button variant="danger" disabled={!reason.trim()} onClick={() => void confirmVoid()}>
              Confirmar anulación
            </Button>
          </div>
        )}
      </div>
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
              {s.status === 'voided' && <Badge tone="danger">Anulada</Badge>}
              <strong className={`num ${s.status === 'voided' ? styles.struck : ''}`}>{formatMoney(s.total_cents)}</strong>
            </button>
          ))
        )}
      </Card>
      {openId && <SaleModal saleId={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}
