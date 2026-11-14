import type { SaleDetail } from '@/database/repositories/sales';
import { formatMoney } from './money';
import { PAYMENT_LABELS } from './payment';
import { getPrintSettings, type PrintSettings } from './printSettings';

export interface TicketContext extends SaleDetail {
  storeName: string;
  storeAddress?: string | null;
  cashier: string | null;
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `<div class="c">${esc(l)}</div>`)
    .join('');

const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace('.', ','));

/**
 * Ticket para impresora térmica de 58 u 80 mm (se elige en Ajustes).
 * El área imprimible es más angosta que el papel: 48 mm en 58 y 72 mm en 80.
 */
export function renderTicketHtml(
  { sale, items, payments, storeName, storeAddress, cashier }: TicketContext,
  settings: PrintSettings = getPrintSettings(),
): string {
  const narrow = settings.paper === 58;
  const date = new Date(sale.occurred_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
  const rows = items
    .map(
      (i) => `<div class="item">${esc(i.description)}</div>
<div class="row"><span>${qty(i.quantity)} x ${formatMoney(i.unit_price_cents)}</span><span>${formatMoney(i.total_cents)}</span></div>`,
    )
    .join('');
  const change = payments.reduce((sum, p) => sum + (p.tendered_cents ?? p.amount_cents) - p.amount_cents, 0);
  const pays = payments
    .map((p) => `<div class="row"><span>${PAYMENT_LABELS[p.method]}</span><span>${formatMoney(p.tendered_cents ?? p.amount_cents)}</span></div>`)
    .join('');
  const discount =
    sale.discount_cents > 0
      ? `<div class="row"><span>Subtotal</span><span>${formatMoney(sale.subtotal_cents)}</span></div>
<div class="row"><span>Descuento</span><span>-${formatMoney(sale.discount_cents)}</span></div>`
      : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(sale.number)}</title><style>
@page { size: ${settings.paper}mm auto; margin: 0; }
html, body { margin: 0; padding: 0; }
body { width: ${narrow ? 48 : 72}mm; margin: 0 auto; padding: 3mm 0 6mm; font: ${narrow ? 11 : 12}px/1.3 'Courier New', monospace; color: #000; background: #fff; }
h1 { font-size: ${narrow ? 16 : 18}px; margin: 0 0 2px; text-align: center; letter-spacing: 1px; }
.c { text-align: center; overflow-wrap: anywhere; } .row { display: flex; justify-content: space-between; gap: 6px; }
.row span:last-child { white-space: nowrap; }
.item { margin-top: 3px; font-weight: bold; overflow-wrap: anywhere; } hr { border: 0; border-top: 1px dashed #000; margin: 5px 0; }
.total { font-size: ${narrow ? 14 : 16}px; font-weight: bold; }
</style></head><body>
${settings.title.trim() ? `<h1>${esc(settings.title.trim())}</h1>` : ''}
${lines(settings.header)}
<div class="c">Sucursal ${esc(storeName)}</div>
${storeAddress ? `<div class="c">${esc(storeAddress)}</div>` : ''}
<hr>
<div class="c">${esc(date)}</div>
<div class="c">Ticket ${esc(sale.number)}</div>
${cashier ? `<div class="c">Atendió: ${esc(cashier)}</div>` : ''}
<hr>${rows}<hr>
${discount}
<div class="row total"><span>TOTAL</span><span>${formatMoney(sale.total_cents)}</span></div>
<hr>${pays}
${change > 0 ? `<div class="row"><span>Vuelto</span><span>${formatMoney(change)}</span></div>` : ''}
${sale.status === 'voided' ? '<hr><div class="c total">ANULADA</div>' : ''}
<hr>${lines(settings.footer)}
<div class="c">Comprobante no válido como factura</div>
</body></html>`;
}

/** Ticket de ejemplo para probar la impresora desde Ajustes. */
export function sampleTicket(storeName: string, storeAddress: string | null, settings: PrintSettings): string {
  const now = new Date().toISOString();
  const item = (line: number, description: string, quantity: number, price: number) => ({
    id: `p${line}`, sale_id: 'prueba', line, product_id: null, barcode: null, description, quantity,
    unit_price_cents: price, unit_cost_cents: 0, discount_cents: 0, total_cents: Math.round(price * quantity),
  });
  const items = [item(1, 'Producto de prueba', 2, 150000), item(2, 'Otro producto con un nombre bastante largo', 1, 99900)];
  const total = items.reduce((t, i) => t + i.total_cents, 0);
  return renderTicketHtml(
    {
      sale: {
        id: 'prueba', store_id: '', device_id: '', cash_session_id: null, user_id: null, number: 'PRUEBA', status: 'completed',
        subtotal_cents: total, discount_cents: 0, total_cents: total, occurred_at: now, voided_at: null, voided_by: null, void_reason: null,
        created_at: now, updated_at: now, version: 1, updated_by_device: '',
      },
      items,
      payments: [{ id: 'pay', sale_id: 'prueba', method: 'cash', amount_cents: total, tendered_cents: 500000, occurred_at: now }],
      storeName,
      storeAddress,
      cashier: null,
    },
    settings,
  );
}

/** Imprime en un iframe oculto para no sacar al vendedor de la pantalla. La venta ya está guardada antes de llamar a esto. */
export function printHtml(html: string): void {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
  frame.srcdoc = html;
  frame.onload = () => {
    frame.contentWindow?.addEventListener('afterprint', () => frame.remove());
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60_000);
  };
  document.body.appendChild(frame);
}
