import { formatMoney } from './money';
import type { Cents, PaymentMethod } from '@/types/domain';

export type PayMode = 'cash' | 'card' | 'transfer' | 'mixed' | 'account';

export interface PaymentDraft {
  method: PaymentMethod;
  amount_cents: Cents;
  tendered_cents: Cents | null;
  account_id?: string;
}

export interface PaymentResult {
  payments: PaymentDraft[];
  change: Cents;
  error: string | null;
}

/** `cash` es lo ingresado en efectivo; null = campo vacío (en modo efectivo significa "justo"). */
export function computePayment(mode: PayMode, total: Cents, cash: Cents | null, accountId: string | null = null): PaymentResult {
  const fail = (error: string): PaymentResult => ({ payments: [], change: 0, error });
  if (total <= 0) return { payments: [], change: 0, error: null };

  if (mode === 'card') {
    return { payments: [{ method: 'card', amount_cents: total, tendered_cents: null }], change: 0, error: null };
  }

  if (mode === 'transfer') {
    return { payments: [{ method: 'transfer', amount_cents: total, tendered_cents: null }], change: 0, error: null };
  }

  if (mode === 'account') {
    if (!accountId) return fail('Elegí la cuenta');
    return { payments: [{ method: 'employee_account', amount_cents: total, tendered_cents: null, account_id: accountId }], change: 0, error: null };
  }

  if (mode === 'cash') {
    const tendered = cash ?? total;
    if (tendered < total) return fail(`Faltan ${formatMoney(total - tendered)}`);
    return { payments: [{ method: 'cash', amount_cents: total, tendered_cents: tendered }], change: tendered - total, error: null };
  }

  if (cash === null || cash <= 0) return fail('Ingresá la parte en efectivo');
  if (cash >= total) return fail('En un pago mixto el efectivo tiene que ser menor al total');
  return {
    payments: [
      { method: 'cash', amount_cents: cash, tendered_cents: cash },
      { method: 'card', amount_cents: total - cash, tendered_cents: null },
    ],
    change: 0,
    error: null,
  };
}

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  debit: 'Débito',
  credit: 'Crédito',
  transfer: 'Transferencia',
  mercadopago: 'Mercado Pago',
  employee_account: 'Cuenta de empleado',
};
