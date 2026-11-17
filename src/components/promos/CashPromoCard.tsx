import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCurrentStore } from '@/contexts/DeviceContext';
import { useToast } from '@/contexts/ToastContext';
import { listPromos, PromoError, removePromo, savePromo, type PromoInput } from '@/database/repositories/cashPromos';
import { listCategories } from '@/database/repositories/categories';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { currentPromo, DAY_NAMES, promoDiscount, promoLabel, promoSchedule } from '@/services/cashPromo';
import { formatMoney } from '@/services/money';
import styles from './CashPromo.module.css';

const ROUNDINGS = [0, 1000, 5000, 10000, 50000, 100000];
/** Lunes primero, como se lee la semana en el local. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const EXAMPLE = 150000;

const EMPTY: PromoInput = { active: true, percent: 10, days: [1, 2, 3, 4, 5, 6, 0], from_time: null, to_time: null, round_cents: 10000, excluded_category_ids: [] };

/** Promo por pagar en efectivo de la sucursal en la que opera este dispositivo. */
export function CashPromoCard() {
  const store = useCurrentStore();
  const toast = useToast();
  const promos = useLiveQuery(() => listPromos(store.id), [store.id], []);
  const [editing, setEditing] = useState<{ id?: string; input: PromoInput } | null>(null);
  const categories = useLiveQuery(listCategories, [], []);
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const now = currentPromo(promos);

  return (
    <Card
      title={`Promo pagando en efectivo · ${store.name}`}
      action={
        <Button size="sm" icon="plus" onClick={() => setEditing({ input: EMPTY })}>
          Agregar
        </Button>
      }
    >
      {promos.length === 0 ? (
        <p className="muted">
          Sin promos. Con una promo, al cobrar en efectivo se descuenta el porcentaje y lo que paga el cliente se redondea para abajo (por ejemplo, $1.500 con 10% queda en $1.300).
        </p>
      ) : (
        <ul className={styles.list}>
          {promos.map((p) => (
            <li key={p.id} className={styles.row}>
              <div className={styles.text}>
                <strong>
                  {promoLabel(p)}{' '}
                  {!p.active ? <Badge>Pausada</Badge> : now?.id === p.id ? <Badge tone="success">Vale ahora</Badge> : null}
                </strong>
                <span className="muted">
                  {promoSchedule(p)} · {p.round_cents > 0 ? `redondea a ${formatMoney(p.round_cents)}` : 'sin redondeo'}
                </span>
                {!!p.excluded_category_ids?.length && (
                  <span className="muted">Sin promo: {p.excluded_category_ids.map((id) => categoryName.get(id) ?? 'categoría borrada').join(', ')}</span>
                )}
              </div>
              <div className={styles.actions}>
                <Button size="sm" onClick={() => void savePromo(store.id, { ...p, active: !p.active }, p.id)}>
                  {p.active ? 'Pausar' : 'Activar'}
                </Button>
                <Button size="sm" onClick={() => setEditing({ id: p.id, input: p })}>
                  Editar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="trash"
                  aria-label="Borrar promo"
                  onClick={async () => {
                    if (!window.confirm(`¿Borrar la ${promoLabel(p).toLowerCase()}?`)) return;
                    await removePromo(p.id);
                    toast('Promo borrada', 'success');
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <PromoEditor
          initial={editing.input}
          categories={categories}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            await savePromo(store.id, input, editing.id);
            toast('Promo guardada', 'success');
            setEditing(null);
          }}
        />
      )}
    </Card>
  );
}

function PromoEditor({
  initial,
  categories,
  onClose,
  onSave,
}: {
  initial: PromoInput;
  categories: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSave: (input: PromoInput) => Promise<void>;
}) {
  const [excluded, setExcluded] = useState<string[]>(initial.excluded_category_ids ?? []);
  const [percentText, setPercentText] = useState(String(initial.percent).replace('.', ','));
  const [days, setDays] = useState<number[]>(initial.days);
  const [allDay, setAllDay] = useState(!initial.from_time);
  const [from, setFrom] = useState(initial.from_time ?? '14:00');
  const [to, setTo] = useState(initial.to_time ?? '18:00');
  const [round, setRound] = useState(initial.round_cents);
  const [error, setError] = useState<string | null>(null);

  const percent = Number(percentText.replace(',', '.'));
  const input: PromoInput = { active: initial.active, percent, days, from_time: allDay ? null : from, to_time: allDay ? null : to, round_cents: round, excluded_category_ids: excluded };
  const sample = Number.isFinite(percent) && percent > 0 && percent < 100 ? promoDiscount(EXAMPLE, input) : null;

  const save = async () => {
    try {
      await onSave(input);
    } catch (e) {
      setError(e instanceof PromoError ? e.message : 'No se pudo guardar');
    }
  };

  return (
    <Modal
      open
      title="Promo pagando en efectivo"
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
        <Field label="Descuento" hint="Sólo si paga todo en efectivo. No se suma a un descuento manual.">
          {(id) => <Input id={id} inputMode="decimal" value={percentText} onChange={(e) => setPercentText(e.target.value)} suffix="%" autoFocus />}
        </Field>

        <div>
          <span className={styles.label}>Días</span>
          <div className={styles.days} role="group" aria-label="Días">
            {WEEK.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={days.includes(d)}
                className={`${styles.day} ${days.includes(d) ? styles.dayOn : ''}`}
                onClick={() => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]))}
              >
                {DAY_NAMES[d]}
              </button>
            ))}
          </div>
        </div>

        <label className={styles.check}>
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> Todo el día
        </label>
        {!allDay && (
          <div className={styles.hours}>
            <Field label="Desde">{(id) => <Input id={id} type="time" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
            <Field label="Hasta">{(id) => <Input id={id} type="time" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
          </div>
        )}

        <Field label="Redondear lo que paga (para abajo)">
          {(id) => (
            <Select id={id} value={round} onChange={(e) => setRound(Number(e.target.value))}>
              {ROUNDINGS.map((r) => (
                <option key={r} value={r}>
                  {r === 0 ? 'Sin redondeo' : `A ${formatMoney(r)}`}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <div>
          <span className={styles.label}>Categorías sin promo</span>
          {categories.length === 0 ? (
            <p className="muted">Todavía no hay categorías: se crean desde Productos.</p>
          ) : (
            <div className={styles.cats}>
              {[...categories]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((c) => (
                  <label key={c.id} className={styles.check}>
                    <input
                      type="checkbox"
                      checked={excluded.includes(c.id)}
                      onChange={(e) => setExcluded((cur) => (e.target.checked ? [...cur, c.id] : cur.filter((x) => x !== c.id)))}
                    />{' '}
                    {c.name}
                  </label>
                ))}
            </div>
          )}
          <p className="muted">Lo de estas categorías se cobra a precio lleno, aunque pague en efectivo.</p>
        </div>

        {sample !== null && (
          <p className={styles.example}>
            Ejemplo: una compra de {formatMoney(EXAMPLE)} paga <strong>{formatMoney(EXAMPLE - sample)}</strong> (descuento de {formatMoney(sample)}).
          </p>
        )}
        {error && <p className={styles.error}>{error}</p>}
      </div>
    </Modal>
  );
}

