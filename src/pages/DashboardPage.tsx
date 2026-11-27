import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/database/db';
import { listShortages } from '@/database/repositories/minStock';
import { ShortagesModal } from '@/components/inventory/ShortagesModal';
import { daySummary } from '@/database/repositories/sales';
import { slowMovers } from '@/database/repositories/reports';
import { idleText } from '@/components/reports/SlowMovers';
import { useCurrentStore } from '@/contexts/DeviceContext';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { SyncIndicator, usePendingSyncCount } from '@/components/layout/SyncIndicator';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, StatCard } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatMoney } from '@/services/money';
import styles from './DashboardPage.module.css';

export function DashboardPage() {
  const store = useCurrentStore();
  const online = useOnlineStatus();
  const pending = usePendingSyncCount();
  const productCount = useLiveQuery(() => db.products.filter((p) => !p.deleted_at).count(), [], 0);
  const lowStock = useLiveQuery(() => listShortages(store.id), [store.id], []);
  const [showAll, setShowAll] = useState(false);
  // Comestibles con stock que no se vendieron en 30 días: puede haber mercadería por vencer.
  const stale = useLiveQuery(async () => (await slowMovers(store.id, 30, 0)).filter((m) => m.perishable), [store.id], []);
  const day = useLiveQuery(() => daySummary(store.id), [store.id], { tickets: 0, total: 0, cash: 0, card: 0, transfer: 0, account: 0 });

  const today = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <>
      <PageHeader title={`Sucursal ${store.name}`} subtitle={today.charAt(0).toUpperCase() + today.slice(1)} actions={<ButtonLink to="/vender" variant="primary" icon="pos" size="lg">Vender</ButtonLink>} />

      <div className={styles.stats}>
        <StatCard label="Ventas del día" value={formatMoney(day.total)} icon="pos" highlight foot="Sin anuladas" />
        <StatCard label="Tickets" value={day.tickets} icon="reports" foot="De hoy" />
        <StatCard label="Efectivo" value={formatMoney(day.cash)} icon="store" foot={`Tarjeta/QR ${formatMoney(day.card)} · Transf. ${formatMoney(day.transfer)} · Cuentas ${formatMoney(day.account)}`} />
        <StatCard label="Productos" value={productCount} icon="products" foot="En catálogo" />
      </div>

      <div className={styles.panels}>
        <Card title="Alertas de stock" action={<Badge tone={lowStock.length ? 'warning' : 'success'}>{lowStock.length}</Badge>}>
          {lowStock.length === 0 ? (
            <p className="muted">No falta nada: tenés al menos lo que vendiste el mismo día de la semana pasada.</p>
          ) : (
            <>
              <ul className={styles.alerts}>
                {lowStock.slice(0, 8).map(({ product, have, should, missing }) => (
                  <li key={product.id}>
                    <span>{product.name}</span>
                    <Badge tone={have <= 0 ? 'danger' : 'warning'}>
                      Tiene {have} · debería {should} · faltan {missing}
                    </Badge>
                  </li>
                ))}
              </ul>
              <Button size="sm" icon="inventory" onClick={() => setShowAll(true)}>
                Ver todo lo que falta ({lowStock.length})
              </Button>
            </>
          )}
        </Card>

        {showAll && <ShortagesModal items={lowStock} storeName={store.name} onClose={() => setShowAll(false)} />}

        {stale.length > 0 && (
          <Card title="Revisá vencimientos" action={<Badge tone="warning">{stale.length}</Badge>}>
            <p className="muted">Comestibles con stock que no se venden hace 30 días o más.</p>
            <ul className={styles.alerts}>
              {stale.slice(0, 8).map((m) => (
                <li key={m.productId}>
                  <span>{m.name}</span>
                  <Badge tone="warning">{idleText(m)}</Badge>
                </li>
              ))}
            </ul>
            {stale.length > 8 && (
              <ButtonLink to="/reportes" size="sm">
                Ver todos en Reportes
              </ButtonLink>
            )}
          </Card>
        )}

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
