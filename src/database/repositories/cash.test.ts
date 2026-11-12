import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { addLine, cartTotals, EMPTY_CART } from '@/services/cart';
import { computePayment } from '@/services/payment';
import { uuidv7 } from '@/services/id';
import { addCashMovement, cashSummary, closeSession, getOpenSession } from './cash';
import { createSale, voidSale } from './sales';

const store = { id: 'store-1', code: 'ORO' };
const cart = addLine(EMPTY_CART, { product_id: 'p1', name: 'Fernet', barcode: '779', unit: 'unit' as const, unit_price_cents: 1000, unit_cost_cents: 600 });

const sell = (userId: string, method: 'cash' | 'card' | 'mixed' = 'cash', tendered: number | null = null) =>
  createSale({ id: uuidv7(), store, userId, cart, payments: computePayment(method, cartTotals(cart).total, tendered).payments });

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('caja por cajero', () => {
  it('la primera venta abre la caja a nombre del cajero y las siguientes entran en ella', async () => {
    expect(await getOpenSession()).toBeUndefined();
    const a = await sell('cajero');
    const open = await getOpenSession();
    expect(open?.opened_by).toBe('cajero');
    expect(open?.opening_cents).toBe(0);
    expect(a.sale.cash_session_id).toBe(open?.id);

    // El dueño vende con la caja del cajero abierta: entra en la misma caja, con su nombre.
    const b = await sell('duenio');
    expect(b.sale.cash_session_id).toBe(open?.id);
    const summary = await cashSummary(open!.id);
    expect(summary?.byUser.map((u) => u.userId).sort()).toEqual(['cajero', 'duenio']);
    expect((await db.sync_queue.toArray()).some((q) => q.table === 'cash_sessions')).toBe(true);
  });

  it('el esperado es sólo el efectivo, menos retiros y sin ventas anuladas', async () => {
    await sell('cajero');
    await sell('cajero', 'card');
    await sell('cajero', 'mixed', 400);
    const voided = await sell('cajero');
    const open = (await getOpenSession())!;
    await voidSale(voided.sale.id, 'cajero', 'Error');
    await addCashMovement({ sessionId: open.id, type: 'withdrawal', amount: 300, reason: 'Proveedor', userId: 'cajero' });

    const summary = (await cashSummary(open.id))!;
    expect(summary.tickets).toBe(3);
    expect(summary.voided).toBe(1);
    expect(summary.byMethod.cash).toBe(1400);
    expect(summary.expected).toBe(1100);
  });

  it('cerrar guarda esperado y contado, informa la diferencia y la próxima venta abre otra caja', async () => {
    await sell('cajero');
    const open = (await getOpenSession())!;
    expect(await closeSession(open.id, 900, 'cajero')).toEqual({ expected: 1000, counted: 900, difference: -100 });

    const closed = await db.cash_sessions.get(open.id);
    expect(closed?.closed_at).not.toBeNull();
    expect(closed?.expected_cents).toBe(1000);
    expect(closed?.version).toBe(2);
    expect(await getOpenSession()).toBeUndefined();
    await expect(closeSession(open.id, 1000, 'cajero')).rejects.toThrow('ya está cerrada');
    await expect(addCashMovement({ sessionId: open.id, type: 'withdrawal', amount: 1, reason: 'x', userId: null })).rejects.toThrow();

    const next = await sell('otro');
    expect(next.sale.cash_session_id).not.toBe(open.id);
  });

  it('valida el retiro', async () => {
    await sell('cajero');
    const open = (await getOpenSession())!;
    await expect(addCashMovement({ sessionId: open.id, type: 'withdrawal', amount: 0, reason: 'x', userId: null })).rejects.toThrow('mayor a cero');
    await expect(addCashMovement({ sessionId: open.id, type: 'withdrawal', amount: 10, reason: ' ', userId: null })).rejects.toThrow('motivo');
  });
});
