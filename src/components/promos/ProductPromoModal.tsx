import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCurrentStore } from '@/contexts/DeviceContext';
import { useToast } from '@/contexts/ToastContext';
import { listProductPromos, ProductPromoError, removeProductPromo, saveProductPromo } from '@/database/repositories/productPromos';
import { dayKey } from '@/database/repositories/tasks';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { formatMoney, parseMoney } from '@/services/money';
import { promoRange } from '@/services/productPromo';
import { parseQuantity } from '@/services/quantity';
import type { Product } from '@/types/domain';
import styles from './CashPromo.module.css';

const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return dayKey(d);
};
/** `AAAA-MM-DD` → `30/11` */
const short = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

/** Promo por cantidad de un producto: precio c/u, desde/hasta qué cantidad y hasta cuándo. */
export function ProductPromoModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const store = useCurrentStore();
  const toast = useToast();
  const promos = useLiveQuery(() => listProductPromos(store.id, product.id), [store.id, product.id], []);
  const [priceText, setPriceText] = useState('');
  const [fromText, setFromText] = useState('2');
  const [toText, setToText] = useState('');
  const [until, setUntil] = useState(inDays(7));
  const [error, setError] = useState<string | null>(null);

  const price = parseMoney(priceText);
  const min = parseQuantity(fromText);
  const max = toText.trim() === '' ? null : parseQuantity(toText);

  const save = async () => {
    setError(null);
    if (price === null) return setError('Ingresá el precio promo');
    if (min === null) return setError('Ingresá desde qué cantidad');
    if (toText.trim() !== '' && max === null) return setError('La cantidad hasta no es válida');
    try {
      await saveProductPromo(store.id, product.id, { unit_price_cents: price, min_qty: min, max_qty: max, valid_from: dayKey(), valid_until: until });
      toast('Promoción creada', 'success');
      onClose();
    } catch (e) {
      setError(e instanceof ProductPromoError ? e.message : 'No se pudo guardar');
    }
  };

  return (
    <Modal
      open
      title="Crear promoción"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={() => void save()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <p>
          <strong>{product.name}</strong>
          <br />
          <span className="muted num">
            Precio normal {formatMoney(product.price_cents)} · sólo en {store.name}
          </span>
        </p>

        {promos.length > 0 && (
          <ul className={styles.list}>
            {promos.map((p) => (
              <li key={p.id} className={styles.row}>
                <div className={styles.text}>
                  <strong className="num">{formatMoney(p.unit_price_cents)} c/u</strong>
                  <span className="muted num">
                    {promoRange(p).replace('Promo ', '')} · {p.valid_from > dayKey() ? `desde el ${short(p.valid_from)} ` : ''}hasta el {short(p.valid_until)}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="trash"
                  aria-label="Borrar promoción"
                  onClick={async () => {
                    if (!window.confirm('¿Borrar esta promoción?')) return;
                    await removeProductPromo(p.id);
                    toast('Promoción borrada', 'success');
                  }}
                />
              </li>
            ))}
          </ul>
        )}

        <Field label="Precio promo c/u">
          {(id) => <Input id={id} prefix="$" inputMode="decimal" value={priceText} onChange={(e) => setPriceText(e.target.value)} autoFocus autoComplete="off" />}
        </Field>
        <div className={styles.hours}>
          <Field label="Desde cantidad">{(id) => <Input id={id} inputMode="decimal" value={fromText} onChange={(e) => setFromText(e.target.value)} autoComplete="off" />}</Field>
          <Field label="Hasta cantidad" hint="Vacío = sin tope">
            {(id) => <Input id={id} inputMode="decimal" value={toText} onChange={(e) => setToText(e.target.value)} autoComplete="off" />}
          </Field>
        </div>
        <Field label="Vigente hasta (inclusive)">{(id) => <Input id={id} type="date" value={until} min={dayKey()} onChange={(e) => setUntil(e.target.value)} />}</Field>

        {price !== null && min !== null && price < product.price_cents && (
          <p className={styles.example}>
            Llevando {String(min).replace('.', ',')}: paga <strong className="num">{formatMoney(Math.round(price * min))}</strong> en vez de{' '}
            <span className="num">{formatMoney(Math.round(product.price_cents * min))}</span>.
            {max !== null && ` Con más de ${String(max).replace('.', ',')} vuelve al precio normal.`}
          </p>
        )}
        {error && <p className={styles.error}>{error}</p>}
      </div>
    </Modal>
  );
}
