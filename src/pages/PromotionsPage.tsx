import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCurrentStore } from '@/contexts/DeviceContext';
import { useToast } from '@/contexts/ToastContext';
import { db } from '@/database/db';
import { listProductPromos, removeProductPromo } from '@/database/repositories/productPromos';
import { dayKey } from '@/database/repositories/tasks';
import { ProductPromoModal } from '@/components/promos/ProductPromoModal';
import { ProductSearchModal } from '@/components/pos/ProductSearchModal';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatMoney } from '@/services/money';
import { promoRange } from '@/services/productPromo';
import type { Product } from '@/types/domain';
import styles from '@/components/promos/CashPromo.module.css';

/** `AAAA-MM-DD` → `30/11` */
const short = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

/** Productos → Promociones: las promos por cantidad de la sucursal (las mismas que se crean desde Escanear). */
export function PromotionsPage() {
  const navigate = useNavigate();
  const store = useCurrentStore();
  const toast = useToast();
  const today = dayKey();
  const rows = useLiveQuery(
    async () => {
      const promos = await listProductPromos(store.id);
      const products = await db.products.bulkGet(promos.map((p) => p.product_id));
      return promos
        .map((promo, i) => ({ promo, product: products[i] }))
        .filter((r): r is { promo: (typeof promos)[number]; product: Product } => r.product !== undefined && !r.product.deleted_at)
        .sort((a, b) => a.product.name.localeCompare(b.product.name, 'es') || a.promo.min_qty - b.promo.min_qty);
    },
    [store.id],
    [],
  );
  const [searching, setSearching] = useState(false);
  const [promoFor, setPromoFor] = useState<Product | null>(null);

  return (
    <>
      <PageHeader
        title="Promociones"
        subtitle={`Sucursal ${store.name}`}
        actions={
          <>
            <Button variant="ghost" icon="back" onClick={() => navigate('/productos')}>
              Productos
            </Button>
            <Button variant="primary" icon="plus" onClick={() => setSearching(true)}>
              Nueva promoción
            </Button>
          </>
        }
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon="cash" title="Sin promociones">
            <p className="muted">Por ejemplo: llevando 2 o más, $1.500 c/u. Tocá Nueva promoción y elegí el producto.</p>
          </EmptyState>
        ) : (
          <ul className={styles.list}>
            {rows.map(({ promo, product }) => (
              <li key={promo.id} className={styles.row}>
                <div className={styles.text}>
                  <strong>
                    {product.name} {promo.valid_from > today ? <Badge>Empieza el {short(promo.valid_from)}</Badge> : <Badge tone="success">Activa</Badge>}
                  </strong>
                  <span className="num">
                    {formatMoney(promo.unit_price_cents)} c/u <span className="muted">(normal {formatMoney(product.price_cents)})</span>
                  </span>
                  <span className="muted num">
                    {promoRange(promo).replace('Promo ', '')} · hasta el {short(promo.valid_until)}
                  </span>
                </div>
                <div className={styles.actions}>
                  <Button size="sm" onClick={() => setPromoFor(product)}>
                    Ver / agregar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="trash"
                    aria-label={`Borrar promoción de ${product.name}`}
                    onClick={async () => {
                      if (!window.confirm(`¿Borrar la promoción de ${product.name}?`)) return;
                      await removeProductPromo(promo.id);
                      toast('Promoción borrada', 'success');
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="muted" style={{ marginTop: 12 }}>
          Se aplican solas al vender, según la cantidad que lleva el cliente. Valen sólo en esta sucursal y se borran de la lista cuando vencen.
        </p>
      </Card>
      {searching && (
        <ProductSearchModal
          storeId={store.id}
          onClose={() => setSearching(false)}
          onPick={(p) => {
            setSearching(false);
            setPromoFor(p);
          }}
        />
      )}
      {promoFor && <ProductPromoModal product={promoFor} onClose={() => setPromoFor(null)} />}
    </>
  );
}
