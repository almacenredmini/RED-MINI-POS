import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrentStore, useDevice } from '@/contexts/DeviceContext';
import { db } from '@/database/db';
import { listMovements, movementLabel, stockValuation } from '@/database/repositories/inventory';
import { effectiveMinStock, getAutoMinMap } from '@/database/repositories/minStock';
import { searchProducts } from '@/database/repositories/products';
import { getStockMap } from '@/database/repositories/stores';
import { useDebounce } from '@/hooks/useDebounce';
import { ImportModal } from '@/components/inventory/ImportModal';
import { MovementModal, type MovementMode } from '@/components/inventory/MovementModal';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, StatCard } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatMoney } from '@/services/money';
import type { Product } from '@/types/domain';
import styles from '@/components/inventory/Inventory.module.css';

const LIST_LIMIT = 200;

function StockTab({ onProduct }: { onProduct: (p: Product) => void }) {
  const store = useCurrentStore();
  const { can } = useAuth();
  const [query, setQuery] = useState('');
  const q = useDebounce(query);
  const products = useLiveQuery(() => searchProducts(q, LIST_LIMIT), [q], []);
  const stock = useLiveQuery(() => getStockMap(store.id), [store.id], new Map<string, number>());
  const autoMin = useLiveQuery(() => getAutoMinMap(store.id), [store.id], new Map());
  const value = useLiveQuery(() => stockValuation(store.id), [store.id], { units: 0, costCents: 0 });

  return (
    <>
      <div className={styles.stats}>
        <StatCard label="Unidades en stock" value={value.units} icon="inventory" />
        {can('products.view_cost') && <StatCard label="Stock valorizado" value={formatMoney(value.costCents)} icon="store" highlight foot="A costo actual" />}
      </div>
      <div className={styles.search}>
        <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre o código…" autoComplete="off" aria-label="Buscar en inventario" />
      </div>
      <Card className={styles.table}>
        {products.length === 0 ? (
          <EmptyState icon="inventory" title={q ? 'Sin resultados' : 'Todavía no hay productos'} />
        ) : (
          products.map((p) => {
            const qty = stock.get(p.id) ?? 0;
            const min = effectiveMinStock(p, autoMin);
            return (
              <button key={p.id} type="button" className={styles.row} onClick={() => onProduct(p)}>
                <span className={styles.rowMain}>
                  <strong>{p.name}</strong>
                  <span className="muted num">Mínimo {min}</span>
                </span>
                <span className={`${styles.rowEnd} num`}>
                  {qty <= 0 ? <Badge tone="danger">{qty}</Badge> : min > 0 && qty <= min ? <Badge tone="warning">{qty}</Badge> : qty}
                </span>
              </button>
            );
          })
        )}
        {products.length === LIST_LIMIT && <p className={styles.note}>Se muestran los primeros {LIST_LIMIT}. Usá el buscador para encontrar el resto.</p>}
      </Card>
    </>
  );
}

function HistoryTab({ product, onClear }: { product: Product | null; onClear: () => void }) {
  const store = useCurrentStore();
  const moves = useLiveQuery(() => listMovements(store.id, product?.id ?? null), [store.id, product?.id], []);
  const productIds = useMemo(() => [...new Set(moves.map((m) => m.product_id))], [moves]);
  const names = useLiveQuery(async () => new Map((await db.products.bulkGet(productIds)).filter((p) => p !== undefined).map((p) => [p.id, p.name])), [productIds], new Map<string, string>());
  const users = useLiveQuery(async () => new Map((await db.users.toArray()).map((u) => [u.id, u.name])), [], new Map<string, string>());

  return (
    <>
      {product && (
        <div className={styles.filter}>
          <Badge tone="accent">{product.name}</Badge>
          <Button size="sm" variant="ghost" icon="close" aria-label="Quitar filtro" onClick={onClear} />
        </div>
      )}
      <Card className={styles.table}>
        {moves.length === 0 ? (
          <EmptyState icon="inventory" title="Sin movimientos" />
        ) : (
          moves.map((m) => (
            <div key={m.id} className={styles.row}>
              <span className={styles.rowMain}>
                <strong>{names.get(m.product_id) ?? 'Producto eliminado'}</strong>
                <span className="muted">
                  {movementLabel(m)}
                  {m.reason ? ` · ${m.reason}` : ''}
                </span>
                <span className="muted num">
                  {new Date(m.occurred_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                  {m.user_id && users.get(m.user_id) ? ` · ${users.get(m.user_id)}` : ''}
                </span>
              </span>
              <span className={`${styles.rowEnd} num ${m.quantity > 0 ? styles.positive : styles.negative}`}>
                {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
              </span>
            </div>
          ))
        )}
      </Card>
    </>
  );
}

export function InventoryPage() {
  const store = useCurrentStore();
  const { stores } = useDevice();
  const { can } = useAuth();
  const [tab, setTab] = useState<'stock' | 'history'>('stock');
  const [filter, setFilter] = useState<Product | null>(null);
  const [mode, setMode] = useState<MovementMode | null>(null);
  const [importing, setImporting] = useState(false);

  return (
    <>
      <PageHeader
        title="Inventario"
        subtitle={`Sucursal ${store.name}`}
        actions={
          <>
            <Button icon="plus" onClick={() => setMode('entry')}>Entrada</Button>
            <Button icon="minus" onClick={() => setMode('exit')}>Salida</Button>
            <Button icon="check" onClick={() => setMode('count')}>Conteo</Button>
            {can('stock.transfer') && stores.length > 1 && <Button icon="store" onClick={() => setMode('transfer')}>Transferir</Button>}
            <Button variant="primary" icon="purchases" onClick={() => setImporting(true)}>Importar Excel</Button>
          </>
        }
      />
      <div className={styles.tabs} role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'stock'} className={`${styles.tab} ${tab === 'stock' ? styles.tabActive : ''}`} onClick={() => setTab('stock')}>
          Stock
        </button>
        <button type="button" role="tab" aria-selected={tab === 'history'} className={`${styles.tab} ${tab === 'history' ? styles.tabActive : ''}`} onClick={() => setTab('history')}>
          Historial
        </button>
      </div>
      {tab === 'stock' ? (
        <StockTab
          onProduct={(p) => {
            setFilter(p);
            setTab('history');
          }}
        />
      ) : (
        <HistoryTab product={filter} onClear={() => setFilter(null)} />
      )}
      {mode && <MovementModal key={mode} mode={mode} onClose={() => setMode(null)} />}
      {importing && <ImportModal onClose={() => setImporting(false)} />}
    </>
  );
}
