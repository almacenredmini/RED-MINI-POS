import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { renderWholesaleHtml } from '@/services/ticket';
import { customerDebts, listCustomers, listWholesaleSales, saveCustomer, saveWholesaleSale, setWholesalePaid, voidWholesaleSale, WholesaleError, wholesaleReport } from './wholesale';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const ORO = { id: 's1', code: 'ORO' };
const URI = { id: 's2', code: 'URI' };
// 24 fernet a $8.000 (costo $6.500) y 12 cocas a $1.500 (costo $1.000).
const items = [
  { product_id: 'p1', name: 'Fernet 750', quantity: 24, cost_cents: 650000, price_cents: 800000 },
  { product_id: 'p2', name: 'Coca 2,25', quantity: 12, cost_cents: 100000, price_cents: 150000 },
];

describe('mayorista', () => {
  it('guarda clientes y no deja repetir el nombre', async () => {
    await saveCustomer({ name: ' Kiosco Pepe ', phone: '341 555', tax_id: '' });
    await expect(saveCustomer({ name: 'kiosco pepe' })).rejects.toThrow('Ya hay un cliente');
    await expect(saveCustomer({ name: '  ' })).rejects.toThrow(WholesaleError);
    const [c] = await listCustomers();
    expect(c).toMatchObject({ name: 'Kiosco Pepe', phone: '341 555', tax_id: null });
    expect((await db.sync_queue.toArray()).map((q) => q.table)).toEqual(['wholesale_customers']);
  });

  it('el ticket no toca stock, caja ni ventas, y suma total y costo', async () => {
    const pepe = await saveCustomer({ name: 'Kiosco Pepe' });
    const sale = await saveWholesaleSale({ store: ORO, customer: pepe, items, method: 'transfer', paid: true, userId: 'u1' });
    expect(sale.number).toMatch(/^M-ORO-[0-9A-F]{4}-00001$/);
    expect(sale.total_cents).toBe(24 * 800000 + 12 * 150000);
    expect(sale.cost_cents).toBe(24 * 650000 + 12 * 100000);
    expect(sale.paid_at).not.toBeNull();
    expect(await db.stock_movements.count()).toBe(0);
    expect(await db.sales.count()).toBe(0);
    expect(await db.cash_sessions.count()).toBe(0);
    const second = await saveWholesaleSale({ store: ORO, customer: null, items: items.slice(0, 1), method: 'cash', paid: true, userId: null });
    expect(second.number.endsWith('-00002')).toBe(true);
  });

  it('valida lo que falta', async () => {
    const base = { store: ORO, customer: null, method: 'cash' as const, paid: true, userId: null };
    await expect(saveWholesaleSale({ ...base, items: [] })).rejects.toThrow('Agregá al menos un producto');
    await expect(saveWholesaleSale({ ...base, items: [{ ...items[0]!, quantity: 0 }] })).rejects.toThrow('Revisá la cantidad de Fernet 750');
    await expect(saveWholesaleSale({ ...base, items: [{ ...items[0]!, price_cents: 0 }] })).rejects.toThrow('precio de venta');
    await expect(saveWholesaleSale({ ...base, items, paid: false })).rejects.toThrow('elegí el cliente');
    await expect(saveWholesaleSale({ ...base, items, method: null })).rejects.toThrow('Elegí cómo pagó');
  });

  it('lleva lo que debe cada cliente y se cobra después', async () => {
    const pepe = await saveCustomer({ name: 'Kiosco Pepe' });
    const owed = await saveWholesaleSale({ store: ORO, customer: pepe, items, method: null, paid: false, userId: null });
    await saveWholesaleSale({ store: URI, customer: pepe, items: items.slice(1), method: null, paid: false, userId: null });
    expect((await customerDebts()).get(pepe.id)).toBe(owed.total_cents + 12 * 150000);

    await setWholesalePaid(owed.id, true, 'cash');
    expect((await customerDebts()).get(pepe.id)).toBe(12 * 150000);
    const paid = await db.wholesale_sales.get(owed.id);
    expect(paid).toMatchObject({ method: 'cash' });
    expect(paid?.paid_at).not.toBeNull();
  });

  it('en reportes va aparte, por sucursal y sin los anulados', async () => {
    const pepe = await saveCustomer({ name: 'Kiosco Pepe' });
    const a = await saveWholesaleSale({ store: ORO, customer: pepe, items, method: 'transfer', paid: true, userId: null });
    const b = await saveWholesaleSale({ store: ORO, customer: pepe, items: items.slice(1), method: null, paid: false, userId: null });
    const c = await saveWholesaleSale({ store: URI, customer: null, items: items.slice(0, 1), method: 'cash', paid: true, userId: null });
    const gone = await saveWholesaleSale({ store: ORO, customer: null, items, method: 'cash', paid: true, userId: null });
    await voidWholesaleSale(gone.id, 'u1');

    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 86_400_000).toISOString();
    const all = await wholesaleReport(null, from, to);
    expect(all.tickets).toBe(3);
    expect(all.total).toBe(a.total_cents + b.total_cents + c.total_cents);
    expect(all.cost).toBe(a.cost_cents + b.cost_cents + c.cost_cents);
    expect(all.pending).toBe(b.total_cents);
    expect(all.byMethod).toEqual([
      { method: 'transfer', total: a.total_cents },
      { method: 'cash', total: c.total_cents },
    ]);
    expect(all.byCustomer.map((r) => [r.label, r.tickets, r.pending])).toEqual([
      ['Kiosco Pepe', 2, b.total_cents],
      ['Sin cliente', 1, 0],
    ]);
    const oro = await wholesaleReport(ORO.id, from, to);
    expect(oro.tickets).toBe(2);
    // Los anulados se siguen viendo en la lista.
    expect((await listWholesaleSales()).length).toBe(4);
  });

  it('imprime el ticket con el cliente y si quedó debiendo', async () => {
    const pepe = await saveCustomer({ name: 'Kiosco Pepe', tax_id: '20-12345678-9' });
    const sale = await saveWholesaleSale({ store: ORO, customer: pepe, items, method: null, paid: false, userId: null });
    const html = renderWholesaleHtml({ sale, storeName: 'Oroño', customer: pepe, seller: 'Joel' }, { paper: 58, title: 'RED MINI', header: '', footer: '' });
    expect(html).toContain('VENTA MAYORISTA');
    expect(html).toContain('Cliente: Kiosco Pepe');
    expect(html).toContain('CUIT: 20-12345678-9');
    expect(html).toContain('24 x $');
    expect(html).toContain('PENDIENTE DE PAGO');
  });
});
