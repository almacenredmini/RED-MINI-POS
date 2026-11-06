import { db } from '../db';
import { getDeviceId } from '../meta';
import { enqueue, newMeta, touchMeta } from '../outbox';
import { formatMoney } from '@/services/money';
import { nowISO, uuidv7 } from '@/services/id';
import type { AccountMovement, Cents, EmployeeAccount, UUID } from '@/types/domain';

export class AccountError extends Error {}

export type AccountInput = Pick<EmployeeAccount, 'name' | 'limit_cents' | 'active'>;

export interface AccountWithBalance extends EmployeeAccount {
  balance_cents: Cents;
  available_cents: Cents;
}

const sum = (rows: AccountMovement[]) => rows.reduce((total, m) => total + m.amount_cents, 0);

/** El saldo no se guarda: siempre sale de los movimientos, así nadie puede cambiarlo a mano. */
async function balanceOf(accountId: UUID): Promise<Cents> {
  return sum(await db.account_movements.where('account_id').equals(accountId).toArray());
}

export async function listAccounts(): Promise<AccountWithBalance[]> {
  const [accounts, movements] = await Promise.all([db.employee_accounts.orderBy('name').toArray(), db.account_movements.toArray()]);
  const balances = new Map<UUID, Cents>();
  for (const m of movements) balances.set(m.account_id, (balances.get(m.account_id) ?? 0) + m.amount_cents);
  return accounts
    .filter((a) => !a.deleted_at)
    .map((a) => {
      const balance_cents = balances.get(a.id) ?? 0;
      return { ...a, balance_cents, available_cents: a.limit_cents - balance_cents };
    });
}

export async function saveAccount(input: AccountInput, existingId?: string): Promise<EmployeeAccount> {
  const name = input.name.trim();
  if (!name) throw new AccountError('Ingresá el nombre del empleado');
  if (!(input.limit_cents >= 0)) throw new AccountError('Ingresá un límite válido');
  const deviceId = await getDeviceId();

  return db.transaction('rw', db.employee_accounts, db.sync_queue, async () => {
    const previous = existingId ? await db.employee_accounts.get(existingId) : undefined;
    const fields = { name, limit_cents: input.limit_cents, active: input.active };
    const account: EmployeeAccount = previous ? { ...touchMeta(previous, deviceId), ...fields } : { id: uuidv7(), ...newMeta(deviceId), ...fields };
    await db.employee_accounts.put(account);
    await enqueue('employee_accounts', account.id, 'upsert', account);
    return account;
  });
}

async function addMovement(movement: Omit<AccountMovement, 'id' | 'occurred_at'>): Promise<void> {
  const row: AccountMovement = { ...movement, id: uuidv7(), occurred_at: nowISO() };
  await db.account_movements.add(row);
  await enqueue('account_movements', row.id, 'upsert', row);
}

interface SaleCharge {
  accountId: UUID;
  amount: Cents;
  saleId: UUID;
  storeId: UUID;
  userId: UUID | null;
  deviceId: UUID;
}

/** Se llama dentro de la transacción de la venta: si supera el límite, no se guarda ni la venta. */
export async function chargeAccount({ accountId, amount, saleId, storeId, userId, deviceId }: SaleCharge): Promise<void> {
  const account = await db.employee_accounts.get(accountId);
  if (!account || !account.active || account.deleted_at) throw new AccountError('La cuenta no está disponible');
  const available = account.limit_cents - (await balanceOf(accountId));
  if (amount > available) throw new AccountError(`${account.name} supera su límite: le quedan ${formatMoney(Math.max(0, available))}`);
  await addMovement({ account_id: accountId, type: 'charge', amount_cents: amount, sale_id: saleId, store_id: storeId, user_id: userId, device_id: deviceId, note: null });
}

export async function reverseCharge(sale: { accountId: UUID; amount: Cents; saleId: UUID; storeId: UUID; userId: UUID | null; deviceId: UUID }): Promise<void> {
  await addMovement({
    account_id: sale.accountId,
    type: 'charge_void',
    amount_cents: -sale.amount,
    sale_id: sale.saleId,
    store_id: sale.storeId,
    user_id: sale.userId,
    device_id: sale.deviceId,
    note: 'Venta anulada',
  });
}

/** Descuento del sueldo: deja el saldo en cero y el detalle queda en el historial. */
export async function settleAccount(accountId: UUID, storeId: UUID, userId: UUID | null): Promise<Cents> {
  const deviceId = await getDeviceId();
  return db.transaction('rw', db.account_movements, db.sync_queue, async () => {
    const balance = await balanceOf(accountId);
    if (balance <= 0) throw new AccountError('La cuenta no tiene saldo para descontar');
    await addMovement({ account_id: accountId, type: 'settlement', amount_cents: -balance, sale_id: null, store_id: storeId, user_id: userId, device_id: deviceId, note: 'Descontado del sueldo' });
    return balance;
  });
}

export async function listAccountMovements(accountId: UUID): Promise<AccountMovement[]> {
  const rows = await db.account_movements.where('account_id').equals(accountId).toArray();
  return rows.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
}
