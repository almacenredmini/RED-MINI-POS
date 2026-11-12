import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { db } from '@/database/db';
import { addCashMovement, cashSummary, closeSession, type CashSummary, type CloseResult } from '@/database/repositories/cash';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { formatMoney, parseMoney } from '@/services/money';
import { PAYMENT_LABELS } from '@/services/payment';
import type { CashSession, Payment } from '@/types/domain';
import styles from './Cash.module.css';

const time = (iso: string) => new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function useUserNames(): Map<string, string> {
  return useLiveQuery(async () => new Map((await db.users.toArray()).map((u) => [u.id, u.name])), [], new Map());
}

/** Diferencia en verde si cuadra, en rojo si falta, en amarillo si sobra. */
export function DifferenceBadge({ value }: { value: number | null }) {
  if (value === null) return <Badge tone="neutral">Abierta</Badge>;
  if (value === 0) return <Badge tone="success">Sin diferencia</Badge>;
  return <Badge tone={value < 0 ? 'danger' : 'warning'}>{value < 0 ? `Faltan ${formatMoney(-value)}` : `Sobran ${formatMoney(value)}`}</Badge>;
}

/** Detalle completo de una caja. Sólo lo ve quien tiene `cash.manage`: el cajero cierra a ciegas. */
export function CashDetail({ summary }: { summary: CashSummary }) {
  const names = useUserNames();
  const { session } = summary;
  const name = (id: string | null) => (id ? (names.get(id) ?? 'Usuario borrado') : 'Sin usuario');
  const diff = session.closed_at ? (session.counted_cents ?? 0) - (session.expected_cents ?? 0) : null;

  return (
    <div className={styles.detail}>
      <dl className={styles.facts}>
        <dt>Abrió</dt>
        <dd>
          {name(session.opened_by)} · {time(session.opened_at)}
        </dd>
        {session.closed_at && (
          <>
            <dt>Cerró</dt>
            <dd>
              {name(session.closed_by)} · {time(session.closed_at)}
            </dd>
          </>
        )}
        <dt>Ventas</dt>
        <dd className="num">
          {formatMoney(summary.total)} · {summary.tickets} {summary.tickets === 1 ? "ticket" : "tickets"}{summary.voided > 0 && ` · ${summary.voided} anuladas`}
        </dd>
        {(Object.entries(summary.byMethod) as [Payment['method'], number][]).map(([method, amount]) => (
          <FactRow key={method} label={PAYMENT_LABELS[method]} value={formatMoney(amount)} />
        ))}
        {summary.withdrawals > 0 && <FactRow label="Retiros" value={`-${formatMoney(summary.withdrawals)}`} />}
        {summary.deposits > 0 && <FactRow label="Ingresos" value={formatMoney(summary.deposits)} />}
        <dt>
          <strong>Efectivo esperado</strong>
        </dt>
        <dd className="num">
          <strong>{formatMoney(session.closed_at ? (session.expected_cents ?? 0) : summary.expected)}</strong>
        </dd>
        {session.closed_at && (
          <>
            <dt>Contado</dt>
            <dd className="num">{formatMoney(session.counted_cents ?? 0)}</dd>
            <dt>Diferencia</dt>
            <dd>
              <DifferenceBadge value={diff} />
            </dd>
          </>
        )}
      </dl>

      {summary.byUser.length > 1 && (
        <section>
          <h3 className={styles.subtitle}>Ventas por usuario</h3>
          <ul className={styles.list}>
            {summary.byUser.map((u) => (
              <li key={u.userId ?? 'none'}>
                <span>{name(u.userId)}</span>
                <span className="num">
                  {u.tickets} · {formatMoney(u.total)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {summary.movements.length > 0 && (
        <section>
          <h3 className={styles.subtitle}>Retiros e ingresos</h3>
          <MovementList movements={summary.movements} names={names} />
        </section>
      )}
      {session.notes && <p className="muted">Nota: {session.notes}</p>}
    </div>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className={styles.indent}>{label}</dt>
      <dd className="num">{value}</dd>
    </>
  );
}

export function MovementList({ movements, names }: { movements: CashSummary['movements']; names: Map<string, string> }) {
  return (
    <ul className={styles.list}>
      {movements.map((m) => (
        <li key={m.id}>
          <span>
            {m.reason}
            <span className="muted">
              {' '}
              · {m.user_id ? names.get(m.user_id) : ''} {time(m.occurred_at)}
            </span>
          </span>
          <span className="num">
            {m.type === 'withdrawal' ? '-' : '+'}
            {formatMoney(m.amount_cents)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CashDetailModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const summary = useLiveQuery(() => cashSummary(sessionId), [sessionId]);
  if (!summary) return null;
  return (
    <Modal open title={summary.session.closed_at ? 'Caja cerrada' : 'Caja abierta'} onClose={onClose}>
      <CashDetail summary={summary} />
    </Modal>
  );
}

/**
 * Cierre con conteo a ciegas: se pide el efectivo contado sin mostrar cuánto debería haber.
 * El cajero sólo ve si hay diferencia; quien tiene `cash.manage` ve los montos.
 */
export function CloseCashModal({ session, onClosed, onCancel, exitAfter }: { session: CashSession; onClosed: () => void; onCancel: () => void; exitAfter?: boolean }) {
  const { user, can } = useAuth();
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CloseResult | null>(null);
  const counted = text.trim() === '' ? null : parseMoney(text);
  const detailed = can('cash.manage');

  const confirm = async () => {
    if (counted === null || busy) return;
    setBusy(true);
    try {
      setResult(await closeSession(session.id, counted, user?.id ?? null));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo cerrar la caja', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <Modal
        open
        title="Caja cerrada"
        onClose={onClosed}
        footer={
          <Button variant="primary" onClick={onClosed} data-autofocus>
            {exitAfter ? 'Salir' : 'Listo'}
          </Button>
        }
      >
        <div className={styles.result}>
          {result.difference === 0 ? (
            <p className={styles.ok}>Caja cerrada. No hay diferencia.</p>
          ) : (
            <p className={styles.bad}>Tenés una diferencia de caja.</p>
          )}
          {detailed && (
            <dl className={styles.facts}>
              <dt>Esperado</dt>
              <dd className="num">{formatMoney(result.expected)}</dd>
              <dt>Contado</dt>
              <dd className="num">{formatMoney(result.counted)}</dd>
              <dt>Diferencia</dt>
              <dd>
                <DifferenceBadge value={result.difference} />
              </dd>
            </dl>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      title="Cerrar caja"
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancelar</Button>
          <Button variant="primary" disabled={counted === null || busy} onClick={() => void confirm()}>
            {busy ? 'Cerrando…' : exitAfter ? 'Cerrar caja y salir' : 'Cerrar caja'}
          </Button>
        </>
      }
    >
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
      >
        <p>Contá todo el efectivo del cajón y escribí el total.</p>
        <Field label="Efectivo contado">
          {(id) => <Input id={id} prefix="$" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" data-autofocus />}
        </Field>
        <p className="muted">Revisalo bien antes de confirmar: el conteo no se puede repetir.</p>
      </form>
    </Modal>
  );
}

export function WithdrawModal({ session, onClose }: { session: CashSession; onClose: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const amount = parseMoney(text);
  const valid = amount !== null && amount > 0 && reason.trim() !== '';

  const save = async () => {
    if (!valid) return;
    try {
      await addCashMovement({ sessionId: session.id, type: 'withdrawal', amount, reason, userId: user?.id ?? null });
      toast(`Retiro de ${formatMoney(amount)} registrado`, 'success');
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo registrar el retiro', 'error');
    }
  };

  return (
    <Modal
      open
      title="Retiro de caja"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!valid} onClick={() => void save()}>
            Registrar retiro
          </Button>
        </>
      }
    >
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Monto">
          {(id) => <Input id={id} prefix="$" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" data-autofocus />}
        </Field>
        <Field label="Motivo">
          {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: pago a proveedor" autoComplete="off" />}
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
