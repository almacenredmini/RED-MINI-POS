import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/database/db';
import { effectiveMinStock, getAutoMinMap } from '@/database/repositories/minStock';
import { daySummary } from '@/database/repositories/sales';
import { getStockMap } from '@/database/repositories/stores';
import { useCurrentStore } from '@/contexts/DeviceContext';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { SyncIndicator, usePendingSyncCount } from '@/components/layout/SyncIndicator';
import { ButtonLink } from '@/components/ui/Button';
import { Card, StatCard } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatMoney } from '@/services/money';
import styles from './DashboardPage.module.css';

function useLowStock(storeId: string) {
  return useLiveQuery(
    async () => {
      const [products, stock, autoMin] = await Promise.all([db.products.filter((p) => !p.deleted_at && p.active).toArray(), getStockMap(storeId), getAutoMinMap(storeId)]);
      return products
        .map((p) => ({ product: p, qty: stock.get(p.id) ?? 0, min: effectiveMinStock(p, autoMin) }))
        .filter(({ qty, min }) => min > 0 && qty <= min)
        .sort((a, b) => a.qty - b.qty);
    },
    [storeId],
    [],
  );
}

export function DashboardPage() {
  const store = useCurrentStore();
  const online = useOnlineStatus();
  const pending = usePendingSyncCount();
  const productCount = useLiveQuery(() => db.products.filter((p) => !p.deleted_at).count(), [], 0);
  const lowStock = useLowStock(store.id);
  const day = useLiveQuery(() => daySummary(store.id), [store.id], { tickets: 0, total: 0, cash: 0, card: 0, transfer: 0, account: 0 });

  const today = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <>
      <PageHeader title={`Sucursal ${store.name}`} subtitle={today.charAt(0).toUpperCase() + today.slice(1)} actions={<ButtonLink to="/vender" variant="primary" icon="pos" size="lg">Vender</ButtonLink>} />

      <div className={styles.stats}>
        <StatCard label="Ventas del día" value={formatMoney(day.total)} icon="pos" highlight foot="Sin anuladas" />
        <StatCard label="Tickets" value={day.tickets} icon="reports" foot="De hoy" />
        <StatCard label="Efectivo" value={formatMoney(day.cash)} icon="store" foot={`Tarjeta ${formatMoney(day.card)} · Transf. ${formatMoney(day.transfer)} · Cuentas ${formatMoney(day.account)}`} />
        <StatCard label="Productos" value={productCount} icon="products" foot="En catálogo" />
      </div>

      <div className={styles.panels}>
        <Card title="Alertas de stock" action={<Badge tone={lowStock.length ? 'warning' : 'success'}>{lowStock.length}</Badge>}>
          {lowStock.length === 0 ? (
            <p className="muted">Sin productos por debajo del mínimo.</p>
          ) : (
            <ul className={styles.alerts}>
              {lowStock.slice(0, 8).map(({ product, qty, min }) => (
                <li key={product.id}>
                  <span>{product.name}</span>
                  <Badge tone={qty <= 0 ? 'danger' : 'warning'}>
                    {qty} / mín {min}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Sincronización">
          <dl className={styles.sync}>
            <dt>Conexión</dt>
            <dd>{online ? <Badge tone="success" dot>En línea</Badge> : <Badge tone="warning" dot>Sin Internet</Badge>}</dd>
            <dt>Cambios en cola</dt>
            <dd className="num">{pending}</dd>
            <dt>Estado</dt>
            <dd><SyncIndicator /></dd>
          </dl>
          <p className={styles.note}>Todo se guarda primero en este dispositivo. Nada depende de Internet para funcionar.</p>
        </Card>
      </div>
    </>
  );
}
