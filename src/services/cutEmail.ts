import type { DailyCut } from '@/database/repositories/cut';
import { diffText as describeDiff, withinTolerance } from './cashDiff';
import { formatMoney } from './money';
import { PAYMENT_LABELS } from './payment';

/** Mail del corte de turno: HTML con estilos en línea (los clientes de correo ignoran <style>). */
export interface CutEmail {
  storeName: string;
  cashier: string;
  openedAt: string;
  closedAt: string;
  cut: DailyCut;
}

const esc = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const when = (iso: string) => new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const hour = (iso: string) => new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const GREEN = '#15803d';
const RED = '#b91c1c';

function row(label: string, value: string, opts: { bold?: boolean; color?: string | undefined } = {}): string {
  const weight = opts.bold ? 'font-weight:700;' : '';
  const color = opts.color ? `color:${opts.color};` : '';
  return `<tr><td style="padding:7px 0;border-bottom:1px solid #eee;${weight}">${esc(label)}</td><td style="padding:7px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;${weight}${color}">${value}</td></tr>`;
}

function section(title: string, rows: string): string {
  return `<h2 style="margin:22px 0 4px;font-size:15px;color:#111;border-bottom:2px solid #f5c400;padding-bottom:4px">${esc(title)}</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:14px">${rows}</table>`;
}

export function cutEmailSubject({ storeName, cashier, openedAt, closedAt, cut }: CutEmail): string {
  const diff = typeof cut.counted === 'number' ? cut.counted - cut.cashInDrawer : 0;
  // Dentro de la tolerancia no se marca en el asunto: se ve igual en el detalle.
  const tail = withinTolerance(diff) ? '' : ` · ${describeDiff(diff).toUpperCase()}`;
  return `Corte del turno de ${cashier} · ${storeName} · ${hour(openedAt)} a ${hour(closedAt)}${tail}`;
}

export function renderCutEmail(info: CutEmail): string {
  const { storeName, cashier, openedAt, closedAt, cut } = info;
  const money = (n: number, sign = '') => `${sign}${esc(formatMoney(n))}`;
  const diff = typeof cut.counted === 'number' ? cut.counted - cut.cashInDrawer : null;
  const diffText = diff === null ? '—' : esc(describeDiff(diff)) + (diff !== 0 && withinTolerance(diff) ? ' (tolerado)' : '');

  const cash = [
    row('Ventas en efectivo', money(cut.cashSales, '+ '), { color: GREEN }),
    cut.deposits ? row('Entradas', money(cut.deposits, '+ '), { color: GREEN }) : '',
    row('Retiros', money(cut.withdrawals, '- '), { color: cut.withdrawals ? RED : undefined }),
    row('Tenía que haber', money(cut.cashInDrawer), { bold: true }),
    typeof cut.counted === 'number' ? row('Contó al cerrar', money(cut.counted), { bold: true }) : '',
    row('Diferencia', diffText, { bold: true, color: diff === null || withinTolerance(diff) ? GREEN : RED }),
  ].join('');
  const methods = Object.entries(cut.byMethod)
    .filter(([, v]) => v)
    .map(([m, v]) => row(PAYMENT_LABELS[m as keyof typeof PAYMENT_LABELS], money(v ?? 0)))
    .join('');
  const moves = cut.movements.map((m) => row(`${m.type === 'withdrawal' ? 'Retiro' : 'Entrada'}: ${m.reason}`, money(m.amount_cents, m.type === 'withdrawal' ? '- ' : '+ '))).join('');
  const cats = cut.byCategory.map((c) => row(c.label, money(c.total))).join('');
  const other = [
    cut.returns.count ? row(`Devoluciones (${cut.returns.count})`, money(cut.returns.total, '- ')) : '',
    cut.voided.count ? row(`Ventas anuladas (${cut.voided.count})`, money(cut.voided.total)) : '',
  ].join('');

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f4f4f5">
<div style="max-width:560px;margin:0 auto;padding:16px;font-family:Arial,Helvetica,sans-serif;color:#222">
<div style="background:#111;color:#fff;padding:14px 18px;border-radius:10px 10px 0 0;font-size:18px;font-weight:700"><span style="color:#f5c400">RED</span> MINI · Sucursal ${esc(storeName)}</div>
<div style="background:#fff;padding:18px;border-radius:0 0 10px 10px">
<h1 style="margin:0;font-size:22px">Corte del turno</h1>
<p style="margin:4px 0 0;color:#555">${esc(when(openedAt))} al ${esc(when(closedAt))}</p>
<p style="margin:2px 0 0;color:#555">Cajero: <strong>${esc(cashier)}</strong></p>
${section('Resumen', [row('Ventas totales', money(cut.salesTotal), { bold: true }), row('Ganancia', money(cut.profit)), row('Número de ventas', String(cut.tickets))].join(''))}
${section('Dinero en caja', cash)}
${section('Pagos', methods || row('Sin ventas', '—'))}
${moves ? section('Retiros y entradas', moves) : ''}
${cats ? section('Ventas por categoría', cats) : ''}
${other ? section('Devoluciones y anulaciones', other) : ''}
<p style="margin:20px 0 0;color:#888;font-size:12px">La ganancia sólo cuenta productos cargados (los comunes no tienen costo). Mail automático de RED MINI POS.</p>
</div></div></body></html>`;
}
