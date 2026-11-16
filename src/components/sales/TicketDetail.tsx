import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrentStore } from '@/contexts/DeviceContext';
import { useToast } from '@/contexts/ToastContext';
import { db } from '@/database/db';
import { getSaleDetail, returnSaleItem, voidSale } from '@/database/repositories/sales';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { formatMoney } from '@/services/money';
import { PAYMENT_LABELS } from '@/services/payment';
import { printHtml, renderTicketHtml } from '@/services/ticket';
import type { SaleItem } from '@/types/domain';
import styles from './Sales.module.css';

const qty = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');
const hour = (iso: string) => new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 * Detalle de un ticket con devolución por producto y cancelación del ticket entero.
 * Sólo lo usa quien tiene `sales.void` (dueño y encargados).
 */
export function TicketDetail({ saleId }: { saleId: string }) {
  const store = useCurrentStore();
  const { user } = useAuth();
  const toast = useToast();
  const data = useLiveQuery(async () => {
    const detail = await getSaleDetail(saleId);
    if (!detail) return null;
    const returns = await db.sale_returns.where('sale_id').equals(saleId).sortBy('occurred_at');
    const ids = [...new Set([detail.sale.user_id, ...returns.map((r) => r.user_id)].filter((x): x is string => !!x))];
    const names = new Map((await db.users.bulkGet(ids)).filter((u) => !!u).map((u) => [u!.id, u!.name]));
    return { ...detail, returns, names };
  }, [saleId]);
  const [returning, setReturning] = useState<SaleItem | null>(null);
  const [amount, setAmount] = useState('1');
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  if (!data) return null;
  const { sale, items, payments, returns, names } = data;
  const cashier = sale.user_id ? names.get(sale.user_id) : undefined;
  const returnedOf = (id: string) => returns.filter((r) => r.sale_item_id === id).reduce((s, r) => s + r.quantity, 0);
  const open = sale.status === 'completed';
  const parsed = Number(amount.replace(',', '.'));
  const left = returning ? returning.quantity - returnedOf(returning.id) : 0;
  const validQty = parsed > 0 && parsed <= left + 1e-9;
  // Mismo cálculo que returnSaleItem: lo que pagó, con su parte del descuento general.
  const gross = returning && validQty ? Math.round(parsed * returning.unit_price_cents) : 0;
  const refund = gross - (sale.subtotal_cents > 0 ? Math.round((gross * sale.discount_cents) / sale.subtotal_cents) : 0);
  const onAccount = payments.length > 0 && payments.every((p) => p.method === 'employee_account');

  const startReturn = (item: SaleItem) => {
    const rest = item.quantity - returnedOf(item.id);
    setVoiding(false);
    setReturning(item);
    setAmount(qty(Math.min(1, rest)));
    setReason('');
  };

  const confirmReturn = async () => {
    if (!returning || busy) return;
    setBusy(true);
    try {
      const r = await returnSaleItem({ saleItemId: returning.id, quantity: parsed, reason, storeId: store.id, userId: user?.id ?? null });
      toast(r.refund_method === 'cash' ? `Devolvé ${formatMoney(r.total_cents)} en efectivo` : `Se descontaron ${formatMoney(r.total_cents)} de la cuenta`, 'success');
      setReturning(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo hacer la devolución', 'error');
    } finally {
      setBusy(false);
    }
  };

  const confirmVoid = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await voidSale(sale.id, user?.id ?? null, reason);
      toast(`Ticket ${sale.number} cancelado`, 'success');
      setVoiding(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo cancelar el ticket', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.detail}>
      <p className="muted">
        {hour(sale.occurred_at)}
        {cashier && ` · Atendió ${cashier}`}
      </p>
      {sale.status === 'voided' && <p className={styles.voided}>Cancelado: {sale.void_reason}</p>}

      <ul className={styles.items}>
        {items.map((i) => {
          const back = returnedOf(i.id);
          return (
            <li key={i.id}>
              <span className={styles.itemName}>
                {qty(i.quantity)} × {i.description}
                {back > 0 && <span className={styles.returned}> · devuelto {qty(back)}</span>}
              </span>
              <span className="num">{formatMoney(i.total_cents)}</span>
              {open && back < i.quantity && (
                <Button size="sm" variant="ghost" onClick={() => startReturn(i)}>
                  Devolver
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {sale.discount_cents > 0 && <p className="muted num">Descuento: -{formatMoney(sale.discount_cents)}</p>}
      <p className={`${styles.total} num`}>{formatMoney(sale.total_cents)}</p>
      <p className="muted">{payments.map((p) => `${PAYMENT_LABELS[p.method]} ${formatMoney(p.amount_cents)}`).join(' + ')}</p>

      {returns.length > 0 && (
        <section className={styles.returns}>
          <h3>Devoluciones</h3>
          <ul className={styles.items}>
            {returns.map((r) => (
              <li key={r.id}>
                <span className={styles.itemName}>
                  {qty(r.quantity)} × {r.description}
                  <span className="muted">
                    {' '}
                    · {r.reason} · {hour(r.occurred_at)}
                    {r.user_id && names.get(r.user_id) ? ` · ${names.get(r.user_id)}` : ''}
                  </span>
                </span>
                <span className="num">-{formatMoney(r.total_cents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {returning && (
        <div className={styles.form}>
          <strong>Devolver {returning.description}</strong>
          <div className={styles.formRow}>
            <Field label={`Cantidad (máx. ${qty(left)})`}>
              {(id) => <Input id={id} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} invalid={!validQty} autoComplete="off" />}
            </Field>
            <Field label="Motivo">
              {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus autoComplete="off" placeholder="Ej.: vino fallado" />}
            </Field>
          </div>
          <p className="muted">
            {onAccount ? 'Se descuenta de la cuenta del empleado' : 'Sale de la caja en efectivo'}: <strong className="num">{formatMoney(refund)}</strong>.{returning.product_id && ' El producto vuelve al stock.'}
          </p>
          <div className={styles.formActions}>
            <Button onClick={() => setReturning(null)}>Cancelar</Button>
            <Button variant="primary" disabled={!validQty || !reason.trim() || busy} onClick={() => void confirmReturn()}>
              Confirmar devolución
            </Button>
          </div>
        </div>
      )}

      {voiding && (
        <div className={styles.form}>
          <Field label="Motivo de la cancelación">
            {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus autoComplete="off" />}
          </Field>
          <p className="muted">El ticket deja de contar en las ventas y en la caja, y los productos vuelven al stock.</p>
          <div className={styles.formActions}>
            <Button onClick={() => setVoiding(false)}>Volver</Button>
            <Button variant="danger" disabled={!reason.trim() || busy} onClick={() => void confirmVoid()}>
              Confirmar cancelación
            </Button>
          </div>
        </div>
      )}

      {!returning && !voiding && (
        <div className={styles.formActions}>
          <Button icon="pos" onClick={() => printHtml(renderTicketHtml({ sale, items, payments, storeName: store.name, storeAddress: store.address, cashier: cashier ?? null }))}>
            Reimprimir
          </Button>
          {open &&
            (returns.length > 0 ? (
              items.some((i) => returnedOf(i.id) < i.quantity) && <span className="muted">Con devoluciones no se cancela: devolvé lo que queda.</span>
            ) : (
              <Button
                variant="danger"
                onClick={() => {
                  setReason('');
                  setVoiding(true);
                }}
              >
                Cancelar ticket
              </Button>
            ))}
        </div>
      )}
    </div>
  );
}
