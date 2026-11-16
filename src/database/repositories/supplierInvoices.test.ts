import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { deleteInvoice, findSupplier, InvoiceError, listInvoices, parsePastedInvoice, saveInvoice, type InvoiceInput } from './supplierInvoices';
import type { Supplier } from '@/types/domain';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const invoice = (items: InvoiceInput['items'], issued_on = '2026-11-10'): InvoiceInput => ({
  store_id: 's1',
  supplier_id: null,
  supplier_name: 'Distribuidora Norte',
  issued_on,
  number: '0001-123',
  total_cents: null,
  items,
  user_id: null,
});

describe('boletas de proveedores', () => {
  it('lee lo copiado del artefacto aunque venga con texto alrededor', () => {
    const pasted = `Boleta para RED MINI:\n${JSON.stringify({
      redmini: 'boleta',
      v: 1,
      proveedor: 'Distribuidora Norte',
      fecha: '2026-11-06',
      comprobante: '0001-123',
      total: 42000,
      items: [{ producto: 'COCA 2,25', cantidad: 2, unitario: 21000 }, { producto: '', cantidad: 1, unitario: 5 }],
    })}\n`;
    const d = parsePastedInvoice(pasted);
    expect(d.supplier_name).toBe('Distribuidora Norte');
    expect(d.issued_on).toBe('2026-11-06');
    expect(d.total_cents).toBe(4_200_000);
    expect(d.items).toEqual([{ name: 'COCA 2,25', quantity: 2, unit_cents: 2_100_000 }]);
    expect(() => parsePastedInvoice('hola')).toThrow(InvoiceError);
    expect(() => parsePastedInvoice('{"items":[]}')).toThrow(InvoiceError);
  });

  it('reconoce al proveedor aunque esté escrito distinto', () => {
    const s = { id: 'p1', name: 'Distribuidora Norte S.A.', deleted_at: null } as Supplier;
    expect(findSupplier([s], 'DISTRIBUIDORA NORTE S A')?.id).toBe('p1');
    expect(findSupplier([s], 'Otro')).toBeUndefined();
  });

  it('guarda la boleta tal como viene, sin tocar productos, y la deja lista para subir', async () => {
    const inv = await saveInvoice(invoice([{ name: ' COCA 2,25 X6 ', quantity: 5, unit_cents: 1_380_000 }]));
    expect(inv.items).toEqual([{ name: 'COCA 2,25 X6', quantity: 5, unit_cents: 1_380_000 }]);
    expect((await listInvoices('s1')).map((i) => i.id)).toEqual([inv.id]);
    expect((await db.sync_queue.toArray()).map((q) => q.table)).toEqual(['supplier_invoices']);
    expect(await db.products.count()).toBe(0);
  });

  it('valida y borra', async () => {
    await expect(saveInvoice(invoice([{ name: 'X', quantity: 1, unit_cents: 0 }]))).rejects.toThrow(InvoiceError);
    await expect(saveInvoice({ ...invoice([{ name: 'X', quantity: 1, unit_cents: 10 }]), supplier_name: ' ' })).rejects.toThrow(InvoiceError);
    const inv = await saveInvoice(invoice([{ name: 'X', quantity: 1, unit_cents: 10 }]));
    await deleteInvoice(inv.id);
    expect(await listInvoices('s1')).toEqual([]);
  });
});
