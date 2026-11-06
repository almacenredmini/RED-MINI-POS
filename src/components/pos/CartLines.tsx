import { Button } from '@/components/ui/Button';
import { formatMoney } from '@/services/money';
import { lineTotal, type CartLine } from '@/services/cart';
import styles from './Pos.module.css';

interface Props {
  lines: CartLine[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChange: (id: string, delta: number) => void;
  onRemove: (id: string) => void;
}

/** Los botones no toman foco: así el lector y los atajos siguen funcionando después de tocarlos. */
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

export function CartLines({ lines, selectedId, onSelect, onChange, onRemove }: Props) {
  return (
    <ul className={styles.lines}>
      {lines.map((l) => (
        <li key={l.product_id} className={`${styles.line} ${l.product_id === selectedId ? styles.lineActive : ''}`} onClick={() => onSelect(l.product_id)}>
          <div className={styles.lineName}>
            <strong>{l.name}</strong>
            <span className="muted num">{formatMoney(l.unit_price_cents)} c/u</span>
          </div>
          <div className={styles.qty}>
            <Button size="sm" icon="minus" aria-label={`Restar ${l.name}`} onMouseDown={keepFocus} onClick={() => onChange(l.product_id, -1)} />
            <span className={`${styles.qtyValue} num`}>{l.quantity}</span>
            <Button size="sm" icon="plus" aria-label={`Sumar ${l.name}`} onMouseDown={keepFocus} onClick={() => onChange(l.product_id, 1)} />
          </div>
          <span className={`${styles.lineTotal} num`}>{formatMoney(lineTotal(l))}</span>
          <Button size="sm" variant="ghost" icon="close" aria-label={`Quitar ${l.name}`} onMouseDown={keepFocus} onClick={() => onRemove(l.product_id)} />
        </li>
      ))}
    </ul>
  );
}
