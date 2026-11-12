import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useDevice } from '@/contexts/DeviceContext';
import { localDay, salesReport, stockValue, type Row, type SalesReport } from '@/database/repositories/reports';
import { BarChart, type Bar } from '@/components/reports/BarChart';
import { SlowMoversCard } from '@/components/reports/SlowMovers';
import { Card, StatCard } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatMoney } from '@/services/money';
import { PAYMENT_LABELS } from '@/services/payment';
import type { Payment } from '@/types/domain';
import styles from './ReportsPage.module.css';

type Preset = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'lastMonth' | 'custom';

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'Hoy' },
  { value: 'yesterday', label: 'Ayer' },
  { value: '7d', label: 'Últimos 7 días' },
  { value: '30d', label: 'Últimos 30 días' },
  { value: 'month', label: 'Este mes' },
  { value: 'lastMonth', label: 'Mes pasado' },
  { value: 'custom', label: 'Elegir fechas' },
];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Rango [desde, hasta) en días locales. */
function presetRange(preset: Preset, from: string, to: string): [Date, Date] {
  const today = startOfDay(new Date());
  switch (preset) {
    case 'today':
      return [today, addDays(today, 1)];
    case 'yesterday':
      return [addDays(today, -1), today];
    case '7d':
      return [addDays(today, -6), addDays(today, 1)];
    case '30d':
      return [addDays(today, -29), addDays(today, 1)];
    case 'month':
      return [new Date(today.getFullYear(), today.getMonth(), 1), addDays(today, 1)];
    case 'lastMonth':
      return [new Date(today.getFullYear(), today.getMonth() - 1, 1), new Date(today.getFullYear(), today.getMonth(), 1)];
    case 'custom': {
      const a = new Date(`${from}T00:00:00`);
      const b = addDays(new Date(`${to}T00:00:00`), 1);
      return a < b ? [a, b] : [b, a];
    }
  }
}

const pct = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(1).replace('.', ',')}%` : '—');
const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace('.', ','));

export function ReportsPage() {
  const { can, canSwitchStore } = useAuth();
  const { stores, currentStore } = useDevice();
  const showCost = can('products.view_cost');
  const [preset, setPreset] = useState<Preset>('7d');
  const [from, setFrom] = useState(() => localDay(addDays(new Date(), -6)));
  const [to, setTo] = useState(() => localDay(new Date()));
  const [storeId, setStoreId] = useState<string>(currentStore?.id ?? '');
  const [start, end] = presetRange(preset, from, to);
  const scope = storeId || null;

  const report = useLiveQuery(() => salesReport(scope, start.toISOString(), end.toISOString()), [scope, start.getTime(), end.getTime()]);
  const stock = useLiveQuery(() => (showCost ? stockValue(scope) : Promise.resolve([])), [scope, showCost], []);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);

  return (
    <>
      <PageHeader title="Reportes" subtitle={storeId ? `Sucursal ${stores.find((s) => s.id === storeId)?.name ?? ''}` : 'Todas las sucursales'} />

      <div className={styles.filters}>
        <Select value={preset} onChange={(e) => setPreset(e.target.value as Preset)} aria-label="Período">
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
        {preset === 'custom' && (
          <>
            <Input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="Desde" />
            <Input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="Hasta" />
          </>
        )}
        {canSwitchStore && stores.length > 1 && (
          <Select value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Sucursal">
            <option value="">Todas las sucursales</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        )}
      </div>

      {!report ? (
        <p className="muted">Calculando…</p>
      ) : (
        <Report report={report} start={start} days={days} showCost={showCost} allStores={!storeId} />
      )}

      <SlowMoversCard storeId={scope} className={styles.block} />

      {showCost && stock.length > 0 && (
        <Card title="Stock valorizado (hoy)" className={styles.block}>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Sucursal</th>
                  <th className="num">Productos</th>
                  <th className="num">Unidades</th>
                  <th className="num">A costo</th>
                  <th className="num">A precio de venta</th>
                </tr>
              </thead>
              <tbody>
                {stock.map((s) => (
                  <tr key={s.storeId}>
                    <td>
                      {s.storeName}
                      {s.negative > 0 && <span className="muted"> · {s.negative} con stock negativo</span>}
                    </td>
                    <td className="num">{s.products}</td>
                    <td className="num">{qty(Math.round(s.units * 1000) / 1000)}</td>
                    <td className="num">{formatMoney(s.cost)}</td>
                    <td className="num">{formatMoney(s.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">No suma los productos con stock negativo ni los que no tienen costo cargado.</p>
        </Card>
      )}
    </>
  );
}

function Report({ report, start, days, showCost, allStores }: { report: SalesReport; start: Date; days: number; showCost: boolean; allStores: boolean }) {
  const profit = report.total - report.cost;
  const dayBars: Bar[] = Array.from({ length: days }, (_, i) => {
    const d = addDays(start, i);
    const key = localDay(d);
    return {
      key,
      label: days > 14 ? String(d.getDate()) : d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric' }),
      value: report.byDay.get(key) ?? 0,
      detail: d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }),
    };
  });
  // Sólo las horas en que se vende algo, de la primera a la última.
  const active = report.byHour.map((h, i) => (h.tickets > 0 ? i : -1)).filter((i) => i >= 0);
  const hourBars: Bar[] =
    active.length === 0
      ? []
      : Array.from({ length: active[active.length - 1]! - active[0]! + 1 }, (_, k) => {
          const h = active[0]! + k;
          const row = report.byHour[h]!;
          return { key: String(h), label: `${h}h`, value: row.total, detail: `De ${h} a ${h + 1} h · ${row.tickets} tickets` };
        });

  return (
    <>
      <div className={styles.stats}>
        <StatCard label="Ventas" value={formatMoney(report.total)} icon="pos" highlight foot={report.voided.count > 0 ? `${report.voided.count} anuladas, ${formatMoney(report.voided.total)}` : 'Sin anuladas'} />
        <StatCard label="Tickets" value={report.tickets} icon="reports" foot={`Promedio ${formatMoney(report.tickets ? Math.round(report.total / report.tickets) : 0)}`} />
        {showCost && <StatCard label="Ganancia bruta" value={formatMoney(profit)} icon="cash" foot={`Margen ${pct(profit, report.total)}`} />}
        <StatCard label="Descuentos" value={formatMoney(report.discount)} icon="minus" foot="Ya restados de las ventas" />
      </div>

      <div className={styles.grid}>
        {days > 1 && (
          <Card title="Ventas por día" className={styles.wide}>
            <BarChart bars={dayBars} format={formatMoney} labelEvery={days > 14 ? 3 : 1} />
          </Card>
        )}
        <Card title="Ventas por horario" className={days > 1 ? undefined : styles.wide}>
          <BarChart bars={hourBars} format={formatMoney} labelEvery={hourBars.length > 12 ? 2 : 1} />
        </Card>
        <Card title="Por medio de pago">
          <table className={styles.table}>
            <tbody>
              {(Object.entries(report.byMethod) as [Payment['method'], number][])
                .sort((a, b) => b[1] - a[1])
                .map(([m, v]) => (
                  <tr key={m}>
                    <td>{PAYMENT_LABELS[m]}</td>
                    <td className="num">{formatMoney(v)}</td>
                    <td className="num muted">{pct(v, report.total)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Card>
        {allStores && report.byStore.length > 0 && <RankCard title="Por sucursal" rows={report.byStore} count="tickets" showCost={showCost} total={report.total} />}
        <RankCard title="Por cajero" rows={report.byUser} count="tickets" showCost={showCost} total={report.total} />
        <RankCard title="Por categoría" rows={report.byCategory} count="quantity" showCost={showCost} total={report.total} />
        <RankCard title="Más vendidos" rows={report.byProduct} count="quantity" showCost={showCost} total={report.total} wide sortable limit={30} />
      </div>
    </>
  );
}

type SortKey = 'total' | 'quantity' | 'profit';

function RankCard({ title, rows, count, showCost, total, wide, sortable, limit }: { title: string; rows: Row[]; count: 'tickets' | 'quantity'; showCost: boolean; total: number; wide?: boolean; sortable?: boolean; limit?: number }) {
  const [sort, setSort] = useState<SortKey>('total');
  const sorted = [...rows].sort((a, b) => (sort === 'quantity' ? b.quantity - a.quantity : sort === 'profit' ? b.total - b.cost - (a.total - a.cost) : b.total - a.total));
  const shown = limit ? sorted.slice(0, limit) : sorted;

  return (
    <Card
      title={title}
      className={wide ? styles.wide : undefined}
      action={
        sortable && (
          <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Ordenar por">
            <option value="total">Por ventas</option>
            <option value="quantity">Por cantidad</option>
            {showCost && <option value="profit">Por ganancia</option>}
          </Select>
        )
      }
    >
      {rows.length === 0 ? (
        <p className="muted">Sin ventas en el período.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th />
                <th className="num">{count === 'tickets' ? 'Tickets' : 'Cant.'}</th>
                <th className="num">Ventas</th>
                <th className="num">%</th>
                {showCost && <th className="num">Ganancia</th>}
                {showCost && <th className="num">Margen</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key}>
                  <td className={styles.name}>{r.label}</td>
                  <td className="num">{count === 'tickets' ? r.tickets : qty(Math.round(r.quantity * 1000) / 1000)}</td>
                  <td className="num">{formatMoney(r.total)}</td>
                  <td className="num muted">{pct(r.total, total)}</td>
                  {showCost && <td className="num">{formatMoney(r.total - r.cost)}</td>}
                  {showCost && <td className="num muted">{pct(r.total - r.cost, r.total)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {limit && rows.length > limit && <p className="muted">Se muestran los primeros {limit} de {rows.length}.</p>}
    </Card>
  );
}
