import { useState, type KeyboardEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { findProductByBarcode, searchProducts } from '@/database/repositories/products';
import { useDebounce } from '@/hooks/useDebounce';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { ScannerModal } from '@/scanner/ScannerModal';
import { formatMoney } from '@/services/money';
import type { Product } from '@/types/domain';
import styles from './Inventory.module.css';

interface Props {
  id?: string;
  onPick: (product: Product) => void;
  autoFocus?: boolean;
}

/** Busca por nombre, código escrito, lector USB (escribe en el campo) o cámara. */
export function ProductPicker({ id, onPick, autoFocus = false }: Props) {
  const [query, setQuery] = useState('');
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = useDebounce(query, 80);
  const results = useLiveQuery(() => (q.trim() ? searchProducts(q, 8) : []), [q], []);

  const pick = (p: Product) => {
    setQuery('');
    setError(null);
    onPick(p);
  };

  const byCode = async (code: string) => {
    const p = await findProductByBarcode(code);
    if (p) pick(p);
    else setError(`Código ${code} no registrado`);
  };

  const onKeyDown = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const text = query.trim();
    if (!text) return;
    const exact = await findProductByBarcode(text);
    if (exact) return pick(exact);
    const first = (await searchProducts(text, 1))[0];
    if (first) return pick(first);
    setError(`No encontré "${text}"`);
  };

  return (
    <div className={styles.picker}>
      <div className={styles.pickerRow}>
        <Input
          {...(id ? { id } : {})}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => void onKeyDown(e)}
          placeholder="Nombre o código…"
          autoComplete="off"
          {...(autoFocus ? { 'data-autofocus': true } : {})}
        />
        <Button icon="scan" aria-label="Escanear con cámara" onClick={() => setScanning(true)} />
      </div>
      {error && <p className={styles.error}>{error}</p>}
      {results.length > 0 && (
        <ul className={styles.pickerList}>
          {results.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => pick(p)}>
                <span>{p.name}</span>
                <span className="muted num">{formatMoney(p.price_cents)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <ScannerModal open={scanning} onClose={() => setScanning(false)} onDetected={(code) => void byCode(code)} />
    </div>
  );
}
