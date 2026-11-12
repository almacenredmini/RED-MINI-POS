import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { LOOKBACK_DAYS, slowMovers, type SlowMover } from '@/database/repositories/reports';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Field';
import styles from './SlowMovers.module.css';

const LIMIT = 100;
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');
const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace('.', ','));

export const idleText = (m: SlowMover) => (m.idleDays === null ? `Más de ${LOOKBACK_DAYS} días` : `${m.idleDays} ${m.idleDays === 1 ? 'día' : 'días'}`);

/** Productos con stock que casi no se venden. Los comestibles se marcan para revisar vencimientos. */
export function SlowMoversCard({ storeId, className }: { storeId: string | null; className?: string | undefined }) {
  const [days, setDays] = useState(30);
  const [maxSold, setMaxSold] = useState(0);
  const [onlyPerishable, setOnlyPerishable] = useState(false);
  const rows = useLiveQuery(() => slowMovers(storeId, days, maxSold), [storeId, days, maxSold]);
  const visible = (rows ?? []).filter((r) => !onlyPerishable || r.perishable);

  return (
    <Card title="Poca rotación" className={className}>
      <div className={styles.filters}>
        <Select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Período">
          {[15, 30, 60, 90].map((d) => (
            <option key={d} value={d}>
              Últimos {d} días
            </option>
          ))}
        </Select>
        <Select value={maxSold} onChange={(e) => setMaxSold(Number(e.target.value))} aria-label="Vendidos">
          <option value={0}>Sin ventas</option>
          <option value={1}>1 vendido o menos</option>
          <option value={3}>3 vendidos o menos</option>
          <option value={5}>5 vendidos o menos</option>
        </Select>
        <label className={styles.check}>
          <input type="checkbox" checked={onlyPerishable} onChange={(e) => setOnlyPerishable(e.target.checked)} /> Sólo comestibles
        </label>
      </div>
      {!rows ? (
        <p className="muted">Calculando…</p>
      ) : visible.length === 0 ? (
        <p className="muted">No hay productos con stock en esa situación.</p>
      ) : (
        <>
          <div className={styles.wrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Categoría</th>
                  <th className="num">Stock</th>
                  <th className="num">Vendidos</th>
                  <th className="num">Última venta</th>
                  <th className="num">Sin vender</th>
                </tr>
              </thead>
              <tbody>
                {visible.slice(0, LIMIT).map((r) => (
                  <tr key={r.productId}>
                    <td>{r.name}</td>
                    <td>
                      {r.category} {r.perishable && <Badge tone="warning">Comestible</Badge>}
                    </td>
                    <td className="num">{qty(r.stock)}</td>
                    <td className="num">{qty(r.sold)}</td>
                    <td className="num">{date(r.lastSale)}</td>
                    <td className="num">{idleText(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">
            {visible.length > LIMIT ? `Se muestran ${LIMIT} de ${visible.length}. ` : `${visible.length} productos. `}
            Las categorías comestibles se marcan en Productos, botón Categorías.
          </p>
        </>
      )}
    </Card>
  );
}
