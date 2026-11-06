import { useMemo, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/database/db';
import { findProductByBarcode, searchProducts } from '@/database/repositories/products';
import { listCategories } from '@/database/repositories/categories';
import { effectiveMinStock, getAutoMinMap } from '@/database/repositories/minStock';
import { getStockMap } from '@/database/repositories/stores';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrentStore } from '@/contexts/DeviceContext';
import { useDebounce } from '@/hooks/useDebounce';
import { useKeyboardWedge } from '@/scanner/useKeyboardWedge';
import { ScannerModal } from '@/scanner/ScannerModal';
import { ButtonLink, Button } from '@/components/ui/Button';
import { Card, EmptyState } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { ProductRow } from '@/components/products/ProductRow';
import styles from './ProductsPage.module.css';

export function ProductsPage() {
  const navigate = useNavigate();
  const store = useCurrentStore();
  const { can } = useAuth();
  const [query, setQuery] = useState('');
  const [scanning, setScanning] = useState(false);
  const q = useDebounce(query);

  const results = useLiveQuery(() => searchProducts(q, 200), [q]);
  const total = useLiveQuery(() => db.products.filter((p) => !p.deleted_at).count(), [], 0);
  const categories = useLiveQuery(listCategories, [], []);
  const stock = useLiveQuery(() => getStockMap(store.id), [store.id], new Map<string, number>());
  const autoMin = useLiveQuery(() => getAutoMinMap(store.id), [store.id], new Map());
  const categoryName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  /** Código escaneado: abre el producto si existe, si no lo crea con el código precargado. */
  const openByCode = async (code: string) => {
    const p = await findProductByBarcode(code);
    navigate(p ? `/productos/${p.id}` : `/productos/nuevo?codigo=${encodeURIComponent(code)}`);
  };

  useKeyboardWedge({ onScan: openByCode });

  const onSearchKey = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !query.trim()) return;
    // Un lector con el cursor en el buscador también termina acá: un código desconocido abre el alta.
    if (/^\d{6,}$/.test(query.trim())) return void (await openByCode(query.trim()));
    const p = await findProductByBarcode(query);
    if (p) navigate(`/productos/${p.id}`);
  };

  return (
    <>
      <PageHeader
        title="Productos"
        subtitle={`${total} ${total === 1 ? 'producto' : 'productos'} en el catálogo`}
        actions={
          <>
            <Button icon="scan" onClick={() => setScanning(true)}>
              Escanear
            </Button>
            <ButtonLink to="/productos/nuevo" variant="primary" icon="plus">
              Nuevo
            </ButtonLink>
          </>
        }
      />

      <div className={styles.search}>
        <Input
          type="search"
          prefix="⌕"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKey}
          placeholder="Buscar por nombre o código…"
          autoComplete="off"
          aria-label="Buscar productos"
        />
      </div>

      <Card className={styles.list}>
        {results === undefined ? null : results.length === 0 ? (
          q ? (
            <EmptyState icon="search" title="Sin resultados">
              <p>No hay productos que coincidan con “{q}”.</p>
              <ButtonLink to={`/productos/nuevo?nombre=${encodeURIComponent(q)}`} variant="primary" icon="plus">
                Crear “{q}”
              </ButtonLink>
            </EmptyState>
          ) : (
            <EmptyState icon="products" title="Todavía no hay productos">
              <p>Cargá el primero a mano o escaneando su código con el celular o el lector.</p>
              <ButtonLink to="/productos/nuevo" variant="primary" icon="plus">
                Nuevo producto
              </ButtonLink>
            </EmptyState>
          )
        ) : (
          results.map((p) => (
            <ProductRow key={p.id} product={p} categoryName={p.category_id ? categoryName.get(p.category_id) : undefined} stock={stock.get(p.id) ?? 0} showMargin={can('products.view_cost')} minStock={effectiveMinStock(p, autoMin)} />
          ))
        )}
      </Card>

      <ScannerModal open={scanning} onClose={() => setScanning(false)} onDetected={(c) => void openByCode(c)} />
    </>
  );
}
