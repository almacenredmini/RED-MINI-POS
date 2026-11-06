import { useState } from 'react';
import { Field, Input } from '@/components/ui/Field';
import { centsToInput, formatMoney, marginPct, markupPct, parseMoney, priceFromMarkup } from '@/services/money';
import styles from './ProductForm.module.css';

interface Props {
  cost: number;
  price: number;
  showCost: boolean;
  canEdit: boolean;
  onChange: (next: { cost: number; price: number }) => void;
}

/** Sin precio cargado no hay % que mostrar (evita un "-100" que confunde). */
const markupText = (cost: number, price: number) => {
  const v = price > 0 ? markupPct(cost, price) : null;
  return v === null ? '' : String(Math.round(v * 10) / 10).replace('.', ',');
};

const selectAll = (e: { target: HTMLInputElement }) => e.target.select();

/**
 * Tres formas de fijar precio, sincronizadas: costo + % de ganancia (estilo Eleventa) o precio directo.
 * Editar el costo mantiene el precio y recalcula el %; editar el % recalcula el precio.
 */
export function PricingFields({ cost, price, showCost, canEdit, onChange }: Props) {
  const [costText, setCostText] = useState(cost ? centsToInput(cost) : '');
  const [priceText, setPriceText] = useState(price ? centsToInput(price) : '');
  const [markup, setMarkup] = useState(markupText(cost, price));

  const margin = marginPct(cost, price);
  const belowCost = price > 0 && cost > 0 && price < cost;

  return (
    <div className={styles.pricing}>
      {showCost && <Field label="Costo">
        {(id) => (
          <Input
            id={id}
            prefix="$"
            inputMode="decimal"
            onFocus={selectAll}
            disabled={!canEdit}
            value={costText}
            onChange={(e) => {
              setCostText(e.target.value);
              const c = parseMoney(e.target.value) ?? 0;
              setMarkup(markupText(c, price));
              onChange({ cost: c, price });
            }}
            onBlur={() => setCostText(cost ? centsToInput(cost) : '')}
          />
        )}
      </Field>}
      {showCost && <Field label="Ganancia" hint="Sobre costo">
        {(id) => (
          <Input
            id={id}
            suffix="%"
            inputMode="decimal"
            onFocus={selectAll}
            value={markup}
            disabled={!canEdit || cost <= 0}
            onChange={(e) => {
              setMarkup(e.target.value);
              const m = Number(e.target.value.replace(',', '.'));
              if (e.target.value.trim() === '' || !Number.isFinite(m)) return;
              const p = priceFromMarkup(cost, m);
              setPriceText(centsToInput(p));
              onChange({ cost, price: p });
            }}
          />
        )}
      </Field>}
      <Field label="Precio de venta" error={belowCost ? 'El precio es menor al costo' : null}>
        {(id) => (
          <Input
            id={id}
            prefix="$"
            inputMode="decimal"
            onFocus={selectAll}
            disabled={!canEdit}
            value={priceText}
            invalid={belowCost}
            onChange={(e) => {
              setPriceText(e.target.value);
              const p = parseMoney(e.target.value) ?? 0;
              setMarkup(markupText(cost, p));
              onChange({ cost, price: p });
            }}
            onBlur={() => setPriceText(price ? centsToInput(price) : '')}
          />
        )}
      </Field>
      {showCost && <div className={styles.marginBox}>
        <span className={styles.marginLabel}>Margen sobre venta</span>
        <span className={`${styles.marginValue} num`}>{margin === null ? '—' : `${margin.toFixed(1)}%`}</span>
        <span className="muted num">Ganás {formatMoney(Math.max(0, price - cost))} por unidad</span>
      </div>}
    </div>
  );
}
