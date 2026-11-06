import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/database/db';
import { useObjectUrl } from '@/hooks/useObjectUrl';
import { Icon } from '@/components/ui/Icon';
import styles from './ProductThumb.module.css';

export function ProductThumb({ productId, hasImage, size = 44 }: { productId: string; hasImage: boolean; size?: number }) {
  const image = useLiveQuery(() => (hasImage ? db.product_images.get(productId) : undefined), [productId, hasImage]);
  const url = useObjectUrl(image?.blob);

  return (
    <div className={styles.thumb} style={{ width: size, height: size }}>
      {url ? <img src={url} alt="" loading="lazy" /> : <Icon name="products" size={size * 0.45} />}
    </div>
  );
}
