import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { db } from '@/database/db';
import { applyPriceRule, bulkUpdatePrices, type PriceMode } from '@/database/repositories/bulkPrices';
import { listCategories } from '@/database/repositories/categories';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { formatMoney, parseMoney } from '@/services/money';
import { normalize } from '@/services/search';
import styles from './ProductTools.module.css';

const PREVIEW = 300;

/** Cambia el precio de varios productos a la vez, por porcentaje o por monto fijo. */
export function BulkPriceModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const products = useLiveQuery(async () => (await db.products.orderBy('name').toArray()).filter((p) => !p.deleted_at), [], []);
  const categories = useLiveQuery(listCategories, [], []);

  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<PriceMode>('percent');
  const [direction, setDirection] = useState<1 | -1>(1);
  const [text, setText] = useState('');
  const [rounding, setRounding] = useState(0);
  const [busy, setBusy] = useState(false);

  const amount = mode === 'percent' ? Number(text.replace(',', '.')) : parseMoney(text);
  const valid = text.trim() !== '' && amount !== null && Number.isFinite(amount) && amount > 0;
  const rule = { mode, value: valid ? direction * (amount ?? 0) : 0, rounding };

  const filtered = useMemo(() => {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    return products.filter((p) => {
      if (category === 'none' && p.category_id !== null) return false;
      if (category && category !== 'none' && p.category_id !== category) return false;
      const name = normalize(p.name);
      return words.every((w) => name.includes(w));
    });
  }, [products, category, query]);

  const allFiltered = filtered.length > 0 && filtered.every((p) => selected.has(p.id));
  const toggleAll = () => {
    const next = new Set(selected);
    for (const p of filtered) {
      if (allFiltered) next.delete(p.id);
      else next.add(p.id);
    }
    setSelected(next);
  };
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const apply = async () => {
    if (!valid || selected.size === 0 || busy) return;
    setBusy(true);
    try {
      const n = await bulkUpdatePrices([...selected], rule, user?.id ?? null);
      toast(n === 1 ? '1 precio actualizado' : `${n} precios actualizados`, 'success');
      onClose();
    } catch {
      toast('No se pudieron cambiar los precios', 'error');
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title="Modificar precios"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!valid || selected.size === 0 || busy} onClick={() => void apply()}>
            {busy ? 'Guardando…' : `Aplicar a ${selected.size} ${selected.size === 1 ? 'producto' : 'productos'}`}
          </Button>
        </>
      }
    >
      <div className={styles.bulk}>
        <div className={styles.ruleRow}>
          <div className={styles.segmented} role="group" aria-label="Tipo de cambio">
            <button type="button" aria-pressed={mode === 'percent'} onClick={() => setMode('percent')}>
              Porcentaje
            </button>
            <button type="button" aria-pressed={mode === 'amount'} onClick={() => setMode('amount')}>
              Monto fijo
            </button>
          </div>
          <div className={styles.segmented} role="group" aria-label="Aumentar o bajar">
            <button type="button" aria-pressed={direction === 1} onClick={() => setDirection(1)}>
              Aumentar
            </button>
            <button type="button" aria-pressed={direction === -1} onClick={() => setDirection(-1)}>
              Bajar
            </button>
          </div>
        </div>
        <div className={styles.ruleRow}>
          <Field label={mode === 'percent' ? 'Porcentaje' : 'Monto'}>
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                {...(mode === 'percent' ? { suffix: '%' } : { prefix: '$' })}
                value={text}
                onChange={(e) => setText(e.target.value)}
                autoComplete="off"
                data-autofocus
              />
            )}
          </Field>
          <Field label="Redondear a">
            {(id) => (
              <Select id={id} value={rounding} onChange={(e) => setRounding(Number(e.target.value))}>
                <option value={0}>Sin redondeo</option>
                <option value={1000}>$10</option>
                <option value={5000}>$50</option>
                <option value={10000}>$100</option>
              </Select>
            )}
          </Field>
        </div>

        <div className={styles.ruleRow}>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Categoría">
            <option value="">Todas las categorías</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="none">Sin categoría</option>
          </Select>
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar producto…" aria-label="Buscar producto" autoComplete="off" />
        </div>

        <div className={styles.pickList}>
          <label className={styles.pickAll}>
            <input type="checkbox" checked={allFiltered} onChange={toggleAll} disabled={filtered.length === 0} />
            <span>
              {filtered.length === 1 ? 'Elegir el producto de la lista' : `Elegir los ${filtered.length} de la lista`}
              {selected.size > 0 && <span className="muted"> · {selected.size} elegidos</span>}
            </span>
          </label>
          {filtered.slice(0, PREVIEW).map((p) => {
            const next = valid ? applyPriceRule(p.price_cents, rule) : null;
            return (
              <label key={p.id} className={styles.pick}>
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                <span className={styles.pickName}>{p.name}</span>
                <span className="num">
                  {formatMoney(p.price_cents)}
                  {selected.has(p.id) && next !== null && next !== p.price_cents && <strong> → {formatMoney(next)}</strong>}
                </span>
              </label>
            );
          })}
          {filtered.length > PREVIEW && <p className="muted">Se muestran los primeros {PREVIEW}. «Elegir los de la lista» incluye todos.</p>}
          {filtered.length === 0 && <p className="muted">No hay productos con ese filtro.</p>}
        </div>
      </div>
    </Modal>
  );
}
