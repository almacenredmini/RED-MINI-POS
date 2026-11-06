import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { formatMoney, marginPct } from '@/services/money';
import type { Product } from '@/types/domain';
import { ProductThumb } from './ProductThumb';
import styles from './ProductRow.module.css';

interface Props {
  product: Product;
  categoryName: string | undefined;
  stock: number;
  showMargin: boolean;
  minStock: number;
}

export function ProductRow({ product: p, categoryName, stock, showMargin, minStock }: Props) {
  const margin = marginPct(p.cost_cents, p.price_cents);
  const low = stock <= minStock;

  return (
    <Link to={`/productos/${p.id}`} className={styles.row}>
      <ProductThumb productId={p.id} hasImage={p.has_image} />
      <div className={styles.main}>
        <span className={styles.name}>{p.name}</span>
        <span className={styles.meta}>{categoryName ?? 'Sin categoría'}</span>
      </div>
      <div className={`${styles.col} ${styles.hideSm} num`}>
        <span className={styles.label}>Margen</span>
        {!showMargin || margin === null ? '—' : `${margin.toFixed(0)}%`}
      </div>
      <div className={`${styles.col} ${styles.hideSm} num`}>
        <span className={styles.label}>Stock</span>
        {low ? <Badge tone={stock <= 0 ? 'danger' : 'warning'}>{stock}</Badge> : stock}
      </div>
      <div className={`${styles.price} num`}>
        {formatMoney(p.price_cents)}
        {!p.active && <Badge>Inactivo</Badge>}
      </div>
    </Link>
  );
}
