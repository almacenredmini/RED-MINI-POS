import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '@/contexts/AuthContext';
import { listAccounts } from '@/database/repositories/accounts';
import { useHotkeys } from '@/hooks/useHotkeys';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { centsToInput, formatMoney, parseMoney } from '@/services/money';
import { computePayment, type PayMode, type PaymentDraft } from '@/services/payment';
import type { Cents } from '@/types/domain';
import styles from './Pos.module.css';

/** Promo de efectivo que vale ahora: sólo se aplica si se paga todo en efectivo. */
export interface PromoOffer {
  label: string;
  discount: Cents;
  /** Aviso cuando hay productos sin promo en la venta (ej. "Sin promo: Cigarrillos"). */
  note?: string | null;
}

interface Props {
  total: Cents;
  promo?: PromoOffer | null;
  /** Puede quitar la promo en esta venta. */
  canRemovePromo?: boolean;
  onClose: () => void;
  /** Debe resolver cuando la venta quedó guardada. `promo`: la que se aplicó, si se aplicó. */
  onConfirm: (payments: PaymentDraft[], print: boolean, promo: PromoOffer | null) => Promise<void>;
}

const MODES: Array<{ mode: PayMode; label: string; key: string }> = [
  { mode: 'cash', label: 'Efectivo', key: 'F3' },
  { mode: 'card', label: 'Tarjeta', key: 'F4' },
  { mode: 'transfer', label: 'Transferencia', key: 'F7' },
  { mode: 'mixed', label: 'Mixto', key: 'F6' },
  { mode: 'account', label: 'Cuenta', key: 'F8' },
];

export function PaymentModal({ total: fullTotal, promo = null, canRemovePromo = false, onClose, onConfirm }: Props) {
  const [mode, setMode] = useState<PayMode>('cash');
  const [promoRemoved, setPromoRemoved] = useState(false);
  const offered = promo && promo.discount > 0 ? promo : null;
  const applied = offered && mode === 'cash' && !promoRemoved ? offered : null;
  const total = fullTotal - (applied?.discount ?? 0);
  const [cashText, setCashText] = useState('');
  const [cardText, setCardText] = useState('');
  const [accountId, setAccountId] = useState('');
  const accounts = useLiveQuery(async () => (await listAccounts()).filter((a) => a.active), [], []);
  const [busy, setBusy] = useState(false);
  // Ref y no sólo estado: dos F1 seguidos llegan antes de que React vuelva a renderizar.
  const submitting = useRef(false);
  const showBalance = useAuth().can('accounts.view_balance');

  const cash = cashText.trim() === '' ? null : parseMoney(cashText);
  const account = accounts.find((a) => a.id === accountId);
  const overLimit = mode === 'account' && account !== undefined && total > account.available_cents;
  const computed = computePayment(mode, total, cash, accountId || null);
  const result = overLimit
    ? { ...computed, error: showBalance ? `Supera el límite: le quedan ${formatMoney(Math.max(0, account.available_cents))}` : 'Supera el límite de la cuenta' }
    : computed;

  const confirm = async (print: boolean) => {
    if (result.error || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      await onConfirm(result.payments, print, applied);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const selectMode = (next: PayMode) => {
    setMode(next);
    setCashText('');
    setCardText('');
  };

  useHotkeys({
    F1: () => void confirm(true),
    F2: () => void confirm(false),
    F3: () => selectMode('cash'),
    F4: () => selectMode('card'),
    F6: () => selectMode('mixed'),
    F7: () => selectMode('transfer'),
    F8: () => selectMode('account'),
    // Evita abrir las herramientas del navegador o el menú con el cobro abierto.
    F10: () => undefined,
    F12: () => undefined,
  });

  return (
    <Modal open title="Cobrar" onClose={onClose}>
      <div className={styles.pay}>
        {applied ? (
          <div className={styles.promo}>
            <span className={`${styles.promoBefore} num`}>{formatMoney(fullTotal)}</span>
            <div className={`${styles.payTotal} num`}>{formatMoney(total)}</div>
            <span className={`${styles.promoText} num`}>
              {applied.label}: -{formatMoney(applied.discount)}
            </span>
            {applied.note && <span className={styles.promoHint}>{applied.note}</span>}
            {canRemovePromo && (
              <Button size="sm" variant="ghost" onClick={() => setPromoRemoved(true)}>
                Quitar promo
              </Button>
            )}
          </div>
        ) : (
          <div className={`${styles.payTotal} num`}>{formatMoney(total)}</div>
        )}
        {offered && !applied && (
          <p className={styles.promoHint}>
            {promoRemoved ? (
              <>
                Promo quitada en esta venta.{' '}
                <button type="button" className={styles.linkButton} onClick={() => setPromoRemoved(false)}>
                  Volver a aplicarla
                </button>
              </>
            ) : (
              <>
                Pagando todo en efectivo: {formatMoney(fullTotal - offered.discount)} ({offered.label})
              </>
            )}
          </p>
        )}

        <div className={styles.modes} role="radiogroup" aria-label="Forma de pago">
          {MODES.map((m) => (
            <button key={m.mode} type="button" role="radio" aria-checked={mode === m.mode} className={`${styles.mode} ${mode === m.mode ? styles.modeActive : ''}`} onClick={() => selectMode(m.mode)}>
              {m.label}
              <kbd className={styles.kbd}>{m.key}</kbd>
            </button>
          ))}
        </div>

        {mode === 'cash' && (
          <Field label="Recibido" hint="Vacío = paga justo">
            {(id) => <Input key="cash" id={id} prefix="$" inputMode="decimal" value={cashText} onChange={(e) => setCashText(e.target.value)} autoFocus data-autofocus autoComplete="off" />}
          </Field>
        )}

        {mode === 'card' && <p className="muted">Se cobra el total con tarjeta.</p>}
        {mode === 'transfer' && <p className="muted">Se cobra el total por transferencia.</p>}

        {mode === 'account' &&
          (accounts.length === 0 ? (
            <p className="muted">Todavía no hay cuentas de empleados. Se crean en la pantalla Cuentas.</p>
          ) : (
            <Field label="Cuenta de empleado" hint="No suma a la caja: se descuenta del sueldo.">
              {(id) => (
                <Select id={id} value={accountId} onChange={(e) => setAccountId(e.target.value)} data-autofocus>
                  <option value="">Elegí un empleado</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {showBalance ? `${a.name} · le quedan ${formatMoney(Math.max(0, a.available_cents))}` : a.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ))}

        {mode === 'mixed' && (
          <div className={styles.mixed}>
            <Field label="Efectivo">
              {(id) => (
                <Input
                  key="mixed-cash"
                  id={id}
                  prefix="$"
                  inputMode="decimal"
                  value={cashText}
                  autoFocus
                  autoComplete="off"
                  onChange={(e) => {
                    setCashText(e.target.value);
                    const c = parseMoney(e.target.value);
                    setCardText(c !== null && c > 0 && c < total ? centsToInput(total - c) : '');
                  }}
                />
              )}
            </Field>
            <Field label="Tarjeta">
              {(id) => (
                <Input
                  id={id}
                  prefix="$"
                  inputMode="decimal"
                  value={cardText}
                  autoComplete="off"
                  onChange={(e) => {
                    setCardText(e.target.value);
                    const c = parseMoney(e.target.value);
                    setCashText(c !== null && c > 0 && c < total ? centsToInput(total - c) : '');
                  }}
                />
              )}
            </Field>
          </div>
        )}

        {result.error && (cash !== null || overLimit) && <p className={styles.payError}>{result.error}</p>}
        {result.change > 0 && (
          <div className={styles.change}>
            <span>Vuelto</span>
            <strong className="num">{formatMoney(result.change)}</strong>
          </div>
        )}

        <div className={styles.payActions}>
          <Button variant="primary" size="lg" block disabled={busy || result.error !== null} onClick={() => void confirm(true)}>
            Cerrar e imprimir ticket <kbd className={styles.kbdDark}>F1</kbd>
          </Button>
          <Button size="lg" block disabled={busy || result.error !== null} onClick={() => void confirm(false)}>
            Cerrar sin imprimir <kbd className={styles.kbd}>F2</kbd>
          </Button>
        </div>
      </div>
    </Modal>
  );
}
