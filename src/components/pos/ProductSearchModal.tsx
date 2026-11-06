import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { searchProducts } from '@/database/repositories/products';
import { getStockMap } from '@/database/repositories/stores';
import { useDebounce } from '@/hooks/useDebounce';
import { Input } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { formatMoney } from '@/services/money';
import type { Product } from '@/types/domain';
import styles from './Pos.module.css';

interface Props {
  storeId: string;
  initialQuery?: string;
  onPick: (product: Product) => void;
  onClose: () => void;
}

export function ProductSearchModal({ storeId, initialQuery = '', onPick, onClose }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [cursor, setCursor] = useState(0);
  const q = useDebounce(query, 80);
  const list = useRef<HTMLUListElement>(null);

  const results = useLiveQuery(async () => (await searchProducts(q, 40)).filter((p) => p.active), [q], []);
  const stock = useLiveQuery(() => getStockMap(storeId), [storeId], new Map<string, number>());

  useEffect(() => setCursor(0), [q]);
  useEffect(() => {
    list.current?.children[cursor]?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const picked = results[cursor];
      if (picked) onPick(picked);
    }
  };

  return (
    <Modal open title="Buscar producto" onClose={onClose}>
      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Nombre o código…"
        autoComplete="off"
        aria-label="Buscar producto"
        data-autofocus
      />
      <ul ref={list} className={styles.results}>
        {results.map((p, i) => (
          <li key={p.id}>
            <button type="button" className={`${styles.result} ${i === cursor ? styles.resultActive : ''}`} onClick={() => onPick(p)}>
              <span className={styles.resultName}>
                <strong>{p.name}</strong>
                <span className="muted">Stock {stock.get(p.id) ?? 0}</span>
              </span>
              <span className={`${styles.resultPrice} num`}>{formatMoney(p.price_cents)}</span>
            </button>
          </li>
        ))}
        {results.length === 0 && <li className="muted">Sin resultados.</li>}
      </ul>
    </Modal>
  );
}
