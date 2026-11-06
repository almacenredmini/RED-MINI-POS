import type { SaleDetail } from '@/database/repositories/sales';
import { formatMoney } from './money';
import { PAYMENT_LABELS } from './payment';

export interface TicketContext extends SaleDetail {
  storeName: string;
  cashier: string | null;
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Ticket térmico de 80 mm. */
export function renderTicketHtml({ sale, items, payments, storeName, cashier }: TicketContext): string {
  const date = new Date(sale.occurred_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
  const rows = items
    .map(
      (i) => `<div class="item">${esc(i.description)}</div>
<div class="row"><span>${i.quantity} x ${formatMoney(i.unit_price_cents)}</span><span>${formatMoney(i.total_cents)}</span></div>`,
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
@page { size: 80mm auto; margin: 0; }
body { width: 72mm; margin: 0 auto; padding: 4mm 0; font: 12px/1.35 'Courier New', monospace; color: #000; }
h1 { font-size: 18px; margin: 0; text-align: center; letter-spacing: 2px; }
.c { text-align: center; } .row { display: flex; justify-content: space-between; gap: 8px; }
.item { margin-top: 4px; font-weight: bold; } hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
.total { font-size: 16px; font-weight: bold; }
</style></head><body>
<h1>RED MINI</h1>
<div class="c">Sucursal ${esc(storeName)}</div>
<div class="c">${esc(date)}</div>
<div class="c">Ticket ${esc(sale.number)}</div>
${cashier ? `<div class="c">Atendió: ${esc(cashier)}</div>` : ''}
<hr>${rows}<hr>
${discount}
<div class="row total"><span>TOTAL</span><span>${formatMoney(sale.total_cents)}</span></div>
<hr>${pays}
${change > 0 ? `<div class="row"><span>Vuelto</span><span>${formatMoney(change)}</span></div>` : ''}
${sale.status === 'voided' ? '<hr><div class="c total">ANULADA</div>' : ''}
<hr><div class="c">Gracias por su compra</div>
<div class="c">Comprobante no válido como factura</div>
</body></html>`;
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
