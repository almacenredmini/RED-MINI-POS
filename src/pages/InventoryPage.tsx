import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrentStore, useDevice } from '@/contexts/DeviceContext';
import { db } from '@/database/db';
import { listCategories } from '@/database/repositories/categories';
import { listMovements, movementLabel, stockByCategory, type CategoryStock } from '@/database/repositories/inventory';
import { effectiveMinStock, getAutoMinMap } from '@/database/repositories/minStock';
import { searchProducts } from '@/database/repositories/products';
import { getStockMap } from '@/database/repositories/stores';
import { useDebounce } from '@/hooks/useDebounce';
import { BulkPriceModal } from '@/components/inventory/BulkPriceModal';
import { ImportModal } from '@/components/inventory/ImportModal';
import { CompareModal } from '@/components/inventory/CompareModal';
import { ProductChangesTab } from '@/components/inventory/ProductChanges';
import { MovementModal, type MovementMode } from '@/components/inventory/MovementModal';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, EmptyState, StatCard } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatMoney } from '@/services/money';
import type { Product } from '@/types/domain';
import styles from '@/components/inventory/Inventory.module.css';

const LIST_LIMIT = 200;
/** Filtro de categoría: 'all' = todas, 'none' = sin categoría, o el id. */
type CategoryFilter = 'all' | 'none' | string;
const qtyText = (n: number) => String(n).replace('.', ',');

function StockTab({ onProduct }: { onProduct: (p: Product) => void }) {
  const store = useCurrentStore();
  const { can } = useAuth();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const q = useDebounce(query);
  const categories = useLiveQuery(listCategories, [], []);
  const products = useLiveQuery(async () => {
    if (category === 'all') return searchProducts(q, LIST_LIMIT);
    const valid = new Set(categories.map((c) => c.id));
    const all = await searchProducts(q, 100_000);
    return all.filter((p) => (category === 'none' ? !p.category_id || !valid.has(p.category_id) : p.category_id === category)).slice(0, LIST_LIMIT);
  }, [q, category, categories], []);
  const stock = useLiveQuery(() => getStockMap(store.id), [store.id], new Map<string, number>());
  const autoMin = useLiveQuery(() => getAutoMinMap(store.id), [store.id], new Map());
  const summary = useLiveQuery(() => stockByCategory(store.id), [store.id]);
  const showCost = can('products.view_cost');
  const zero: CategoryStock = { categoryId: null, name: '', products: 0, units: 0, costCents: 0, priceCents: 0 };
  const current =
    category === 'all' ? summary?.total : summary?.rows.find((r) => (category === 'none' ? r.categoryId === null : r.categoryId === category));
  const shown = current ?? zero;
  const categoryLabel = category === 'all' ? 'Todas las categorías' : category === 'none' ? 'Sin categoría' : (categories.find((c) => c.id === category)?.name ?? '');

  return (
    <>
      <div className={styles.filters}>
        <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filtrar por categoría">
          <option value="all">Todas las categorías</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="none">Sin categoría</option>
        </Select>
        <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre o código…" autoComplete="off" aria-label="Buscar en inventario" />
      </div>
      <div className={styles.stats}>
        <StatCard label="Productos con stock" value={shown.products} icon="products" foot={categoryLabel} />
        <StatCard label="Unidades" value={qtyText(shown.units)} icon="inventory" />
        {showCost && <StatCard label="Valor a costo" value={formatMoney(shown.costCents)} icon="store" highlight foot="Lo que te costó" />}
        <StatCard label="Valor a precio de venta" value={formatMoney(shown.priceCents)} icon="cash" foot="Si vendieras todo" />
      </div>
      {category === 'all' && summary && summary.rows.length > 0 && (
        <Card title="Por categoría" className={styles.byCategory}>
          <table className={styles.catTable}>
            <thead>
              <tr>
                <th>Categoría</th>
                <th className="num">Productos</th>
                <th className="num">Unidades</th>
                {showCost && <th className="num">Costo</th>}
                <th className="num">Venta</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((r) => (
                <tr key={r.categoryId ?? 'none'} onClick={() => setCategory(r.categoryId ?? 'none')} title="Ver esta categoría">
                  <td>{r.name}</td>
                  <td className="num">{r.products}</td>
                  <td className="num">{qtyText(r.units)}</td>
                  {showCost && <td className="num">{formatMoney(r.costCents)}</td>}
                  <td className="num">{formatMoney(r.priceCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="num">{summary.total.products}</td>
                <td className="num">{qtyText(summary.total.units)}</td>
                {showCost && <td className="num">{formatMoney(summary.total.costCents)}</td>}
                <td className="num">{formatMoney(summary.total.priceCents)}</td>
              </tr>
            </tfoot>
          </table>
        </Card>
      )}
      <Card className={styles.table}>
        {products.length === 0 ? (
          <EmptyState icon="inventory" title={q || category !== 'all' ? 'Sin resultados' : 'Todavía no hay productos'} />
        ) : (
          products.map((p) => {
            const qty = stock.get(p.id) ?? 0;
            const min = effectiveMinStock(p, autoMin);
            return (
              <button key={p.id} type="button" className={styles.row} onClick={() => onProduct(p)}>
                <span className={styles.rowMain}>
                  <strong>{p.name}</strong>
                  <span className="muted num">{p.track_stock === false ? 'Stock ilimitado' : `Mínimo ${min}`}</span>
                </span>
                <span className={`${styles.rowEnd} num`}>
                  {p.track_stock === false ? '∞' : qty <= 0 ? <Badge tone="danger">{qty}</Badge> : min > 0 && qty <= min ? <Badge tone="warning">{qty}</Badge> : qty}
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
  const [tab, setTab] = useState<'stock' | 'history' | 'changes'>('stock');
  const [pricing, setPricing] = useState(false);
  const [filter, setFilter] = useState<Product | null>(null);
  const [mode, setMode] = useState<MovementMode | null>(null);
  const [importing, setImporting] = useState(false);
  const [comparing, setComparing] = useState(false);

  return (
    <>
      <PageHeader
        title="Inventario"
        subtitle={`Sucursal ${store.name}`}
        actions={
          <>
            <ButtonLink to="/inventario/descargar" icon="purchases">Mercadería a descargar</ButtonLink>
            <Button icon="plus" onClick={() => setMode('entry')}>Entrada</Button>
            <Button icon="minus" onClick={() => setMode('exit')}>Salida</Button>
            <Button icon="check" onClick={() => setMode('count')}>Conteo</Button>
            {can('stock.transfer') && stores.length > 1 && <Button icon="store" onClick={() => setMode('transfer')}>Transferir</Button>}
            {can('products.edit_price') && <Button icon="cash" onClick={() => setPricing(true)}>Modificar precios</Button>}
            <Button icon="reports" onClick={() => setComparing(true)}>Comparar Excel</Button>
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
        <button type="button" role="tab" aria-selected={tab === 'changes'} className={`${styles.tab} ${tab === 'changes' ? styles.tabActive : ''}`} onClick={() => setTab('changes')}>
          Reporte de movimientos
        </button>
      </div>
      {tab === 'changes' ? (
        <ProductChangesTab />
      ) : tab === 'stock' ? (
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
      {comparing && <CompareModal onClose={() => setComparing(false)} />}
      {pricing && <BulkPriceModal onClose={() => setPricing(false)} />}
    </>
  );
}
