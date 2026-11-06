import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { addLine, changeQuantity, cartTotals, EMPTY_CART, type Cart } from '@/services/cart';
import { computePayment } from '@/services/payment';
import { renderTicketHtml } from '@/services/ticket';
import { AccountError, listAccounts, saveAccount, settleAccount } from './accounts';
import { createSale, daySummary, voidSale } from './sales';
import { uuidv7 } from '@/services/id';

const store = { id: 'store-1', code: 'ORO' };
const line = { product_id: 'p1', name: 'Fernet', barcode: '779', unit: 'unit' as const, unit_price_cents: 1000, unit_cost_cents: 600 };

const cartOf = (qty: number): Cart => {
  const c = addLine(EMPTY_CART, line);
  return qty > 1 ? changeQuantity(c, 'p1', qty - 1) : c;
};

const sell = (cart: Cart, id = uuidv7()) =>
  createSale({ id, store, userId: 'u1', cart, payments: computePayment('cash', cartTotals(cart).total, null).payments });

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('carrito y cobro', () => {
  it('suma, resta y quita la línea en cero', () => {
    const c = addLine(addLine(EMPTY_CART, line), line);
    expect(c.lines[0]?.quantity).toBe(2);
    expect(changeQuantity(changeQuantity(c, 'p1', -1), 'p1', -1).lines).toHaveLength(0);
  });

  it('aplica descuentos sin pasarse del subtotal', () => {
    expect(cartTotals({ ...cartOf(2), discount: { type: 'pct', value: 10 } }).total).toBe(1800);
    expect(cartTotals({ ...cartOf(1), discount: { type: 'amount', value: 5000 } }).total).toBe(0);
  });

  it('calcula vuelto, faltante y mixto', () => {
    expect(computePayment('cash', 1000, 1500).change).toBe(500);
    expect(computePayment('cash', 1000, 500).error).toContain('Faltan');
    expect(computePayment('cash', 1000, null).payments[0]?.tendered_cents).toBe(1000);
    expect(computePayment('card', 1000, null).payments[0]?.method).toBe('card');
    expect(computePayment('mixed', 1000, 400).payments.map((p) => p.amount_cents)).toEqual([400, 600]);
    expect(computePayment('mixed', 1000, 1000).error).not.toBeNull();
    expect(computePayment('mixed', 1000, null).error).not.toBeNull();
  });
});

describe('ventas', () => {
  it('guarda venta, pagos, baja stock con movimiento y encola todo', async () => {
    const { sale } = await sell(cartOf(3));
    expect(sale.total_cents).toBe(3000);
    expect(sale.number).toMatch(/^ORO-[0-9A-F]{4}-000001$/);
    expect((await db.stock.get('store-1:p1'))?.quantity).toBe(-3);

    const moves = await db.stock_movements.toArray();
    expect(moves.map((m) => [m.type, m.quantity])).toEqual([['sale', -3]]);

    const tables = (await db.sync_queue.toArray()).map((q) => q.table);
    expect(tables).toEqual(expect.arrayContaining(['sales', 'sale_items', 'payments', 'stock_movements']));
  });

  it('el mismo id no duplica la venta ni descuenta dos veces', async () => {
    const id = uuidv7();
    await sell(cartOf(1), id);
    await expect(sell(cartOf(1), id)).rejects.toThrow();
    expect(await db.sales.count()).toBe(1);
    expect((await db.stock.get('store-1:p1'))?.quantity).toBe(-1);
  });

  it('numera en secuencia', async () => {
    await sell(cartOf(1));
    const { sale } = await sell(cartOf(1));
    expect(sale.number.endsWith('000002')).toBe(true);
  });

  it('anular devuelve el stock, conserva el historial y no se puede repetir', async () => {
    const { sale } = await sell(cartOf(2));
    await voidSale(sale.id, 'u1', 'Error de carga');
    expect((await db.sales.get(sale.id))?.status).toBe('voided');
    expect((await db.stock.get('store-1:p1'))?.quantity).toBe(0);
    expect(await db.stock_movements.count()).toBe(2);
    await expect(voidSale(sale.id, 'u1', 'otra vez')).rejects.toThrow('ya está anulada');
  });

  it('el resumen del día excluye anuladas', async () => {
    await sell(cartOf(1));
    const { sale } = await sell(cartOf(2));
    await voidSale(sale.id, 'u1', 'x');
    expect(await daySummary(store.id)).toMatchObject({ tickets: 1, total: 1000, cash: 1000 });
  });

  it('el ticket escapa el nombre del producto y muestra el vuelto', async () => {
    const cart = addLine(EMPTY_CART, { ...line, name: '<b>Vino & Co</b>' });
    const detail = await createSale({ id: uuidv7(), store, userId: null, cart, payments: computePayment('cash', 1000, 2000).payments });
    const html = renderTicketHtml({ ...detail, storeName: 'Oroño', cashier: null });
    expect(html).not.toContain('<b>Vino');
    expect(html).toContain('Vuelto');
  });
});

describe('transferencia y cuentas de empleado', () => {
  const account = () => saveAccount({ name: 'Juan', limit_cents: 5000, active: true });
  const sellToAccount = (accountId: string, qty: number) => {
    const cart = cartOf(qty);
    return createSale({ id: uuidv7(), store, userId: 'u1', cart, payments: computePayment('account', cartTotals(cart).total, null, accountId).payments });
  };
  const balance = async () => (await listAccounts())[0]?.balance_cents;

  it('la transferencia se registra y no suma a efectivo ni tarjeta', async () => {
    const cart = cartOf(2);
    await createSale({ id: uuidv7(), store, userId: null, cart, payments: computePayment('transfer', 2000, null).payments });
    expect(await daySummary(store.id)).toMatchObject({ total: 2000, cash: 0, card: 0, transfer: 2000 });
  });

  it('pide elegir la cuenta', () => {
    expect(computePayment('account', 1000, null).error).toBe('Elegí la cuenta');
  });

  it('carga a la cuenta y no suma a la caja', async () => {
    const a = await account();
    await sellToAccount(a.id, 2);
    expect(await balance()).toBe(2000);
    expect((await listAccounts())[0]?.available_cents).toBe(3000);
    expect(await daySummary(store.id)).toMatchObject({ total: 2000, cash: 0, account: 2000 });
  });

  it('si supera el límite no se guarda ni la venta ni el stock', async () => {
    const a = await account();
    await sellToAccount(a.id, 4);
    await expect(sellToAccount(a.id, 2)).rejects.toBeInstanceOf(AccountError);
    expect(await balance()).toBe(4000);
    expect(await db.sales.count()).toBe(1);
    expect((await db.stock.get('store-1:p1'))?.quantity).toBe(-4);
  });

  it('una cuenta inactiva no acepta compras', async () => {
    const a = await account();
    await saveAccount({ name: 'Juan', limit_cents: 5000, active: false }, a.id);
    await expect(sellToAccount(a.id, 1)).rejects.toThrow('no está disponible');
  });

  it('anular la venta baja la deuda', async () => {
    const a = await account();
    const { sale } = await sellToAccount(a.id, 3);
    await voidSale(sale.id, 'u1', 'Error');
    expect(await balance()).toBe(0);
  });

  it('descontar del sueldo deja el saldo en cero y conserva el historial', async () => {
    const a = await account();
    await sellToAccount(a.id, 3);
    expect(await settleAccount(a.id, store.id, 'u1')).toBe(3000);
    expect(await balance()).toBe(0);
    expect(await db.account_movements.count()).toBe(2);
    await expect(settleAccount(a.id, store.id, 'u1')).rejects.toThrow('no tiene saldo');
    await sellToAccount(a.id, 5);
    expect(await balance()).toBe(5000);
  });
});
