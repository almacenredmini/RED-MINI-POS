import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCurrentStore } from '@/contexts/DeviceContext';
import { useToast } from '@/contexts/ToastContext';
import { listPromos, PromoError, removePromo, savePromo, type PromoInput } from '@/database/repositories/cashPromos';
import { listCategories } from '@/database/repositories/categories';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { ALL_METHODS, DAY_NAMES, discountMethods, discountScope, discountTitle, METHOD_NAMES, promoAppliesAt, promoDiscount, promoSchedule } from '@/services/cashPromo';
import { formatMoney } from '@/services/money';
import type { CashPromo, DiscountMethod } from '@/types/domain';
import styles from '@/components/promos/CashPromo.module.css';

const ROUNDINGS = [0, 1000, 5000, 10000, 50000, 100000];
/** Lunes primero, como se lee la semana en el local. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const EXAMPLE = 150000;

const EMPTY: PromoInput = {
  active: true,
  percent: 10,
  methods: ['cash'],
  category_mode: 'all',
  category_ids: [],
  days: [1, 2, 3, 4, 5, 6, 0],
  from_time: null,
  to_time: null,
  round_cents: 10000,
};

const toInput = (p: CashPromo): PromoInput => {
  const scope = discountScope(p);
  return { active: p.active, percent: p.percent, methods: discountMethods(p), category_mode: scope.mode, category_ids: scope.ids, days: p.days, from_time: p.from_time, to_time: p.to_time, round_cents: p.round_cents };
};

/** Productos → Descuentos: % según la forma de pago, sobre todo o sobre ciertas categorías. */
export function DiscountsPage() {
  const navigate = useNavigate();
  const store = useCurrentStore();
  const toast = useToast();
  const promos = useLiveQuery(() => listPromos(store.id), [store.id], []);
  const categories = useLiveQuery(listCategories, [], []);
  const [editing, setEditing] = useState<{ id?: string; input: PromoInput } | null>(null);
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const now = new Date();

  const scopeText = (p: CashPromo) => {
    const { mode, ids } = discountScope(p);
    const names = ids.map((id) => categoryName.get(id) ?? 'categoría borrada').join(', ');
    return mode === 'all' ? 'En todos los productos' : mode === 'only' ? `Sólo en: ${names}` : `Todo menos: ${names}`;
  };

  return (
    <>
      <PageHeader
        title="Descuentos"
        subtitle={`Sucursal ${store.name}`}
        actions={
          <>
            <Button variant="ghost" icon="back" onClick={() => navigate('/productos')}>
              Productos
            </Button>
            <Button variant="primary" icon="plus" onClick={() => setEditing({ input: EMPTY })}>
              Nuevo descuento
            </Button>
          </>
        }
      />
      <Card>
        {promos.length === 0 ? (
          <EmptyState icon="cash" title="Sin descuentos">
            <p className="muted">Por ejemplo: 10% pagando en efectivo, o 5% en Bebidas con transferencia. Se aplica solo al cobrar, según la forma de pago.</p>
          </EmptyState>
        ) : (
          <ul className={styles.list}>
            {promos.map((p) => (
              <li key={p.id} className={styles.row}>
                <div className={styles.text}>
                  <strong>
                    {discountTitle(p)} {!p.active ? <Badge>Pausado</Badge> : promoAppliesAt(p, now) ? <Badge tone="success">Vale ahora</Badge> : null}
                  </strong>
                  <span className="muted">{scopeText(p)}</span>
                  <span className="muted">
                    {promoSchedule(p)} · {p.round_cents > 0 ? `redondea a ${formatMoney(p.round_cents)}` : 'sin redondeo'}
                  </span>
                </div>
                <div className={styles.actions}>
                  <Button size="sm" onClick={() => void savePromo(store.id, { ...toInput(p), active: !p.active }, p.id)}>
                    {p.active ? 'Pausar' : 'Activar'}
                  </Button>
                  <Button size="sm" onClick={() => setEditing({ id: p.id, input: toInput(p) })}>
                    Editar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="trash"
                    aria-label="Borrar descuento"
                    onClick={async () => {
                      if (!window.confirm(`¿Borrar el descuento de ${discountTitle(p)}?`)) return;
                      await removePromo(p.id);
                      toast('Descuento borrado', 'success');
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="muted" style={{ marginTop: 12 }}>
          Si a un producto le tocan dos descuentos, vale el mayor. No se aplican en pagos mixtos, ni a productos con promoción por cantidad, ni junto con un
          descuento manual.
        </p>
      </Card>
      {editing && (
        <DiscountEditor
          initial={editing.input}
          categories={categories}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            await savePromo(store.id, input, editing.id);
            toast('Descuento guardado', 'success');
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function DiscountEditor({
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
  const [percentText, setPercentText] = useState(String(initial.percent).replace('.', ','));
  const [methods, setMethods] = useState<DiscountMethod[]>(initial.methods);
  const [mode, setMode] = useState(initial.category_mode);
  const [ids, setIds] = useState<string[]>(initial.category_ids);
  const [days, setDays] = useState<number[]>(initial.days);
  const [allDay, setAllDay] = useState(!initial.from_time);
  const [from, setFrom] = useState(initial.from_time ?? '14:00');
  const [to, setTo] = useState(initial.to_time ?? '18:00');
  const [round, setRound] = useState(initial.round_cents);
  const [error, setError] = useState<string | null>(null);

  const percent = Number(percentText.replace(',', '.'));
  const input: PromoInput = {
    active: initial.active,
    percent,
    methods: ALL_METHODS.filter((m) => methods.includes(m)),
    category_mode: mode,
    category_ids: ids,
    days,
    from_time: allDay ? null : from,
    to_time: allDay ? null : to,
    round_cents: round,
  };
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
      title="Descuento"
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
        <Field label="Porcentaje">{(id) => <Input id={id} inputMode="decimal" value={percentText} onChange={(e) => setPercentText(e.target.value)} suffix="%" autoFocus />}</Field>

        <div>
          <span className={styles.label}>Pagando con</span>
          <div className={styles.methods} role="group" aria-label="Formas de pago">
            {ALL_METHODS.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={methods.includes(m)}
                className={`${styles.day} ${methods.includes(m) ? styles.dayOn : ''}`}
                onClick={() => setMethods((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]))}
              >
                {METHOD_NAMES[m]}
              </button>
            ))}
          </div>
          <p className="muted">Tiene que pagar todo con una de estas formas. En pagos mixtos no se aplica.</p>
        </div>

        <Field label="En qué productos">
          {(id) => (
            <Select id={id} value={mode} onChange={(e) => setMode(e.target.value as PromoInput['category_mode'])}>
              <option value="all">En todos</option>
              <option value="only">Sólo en estas categorías</option>
              <option value="except">En todos menos estas categorías</option>
            </Select>
          )}
        </Field>
        {mode !== 'all' &&
          (categories.length === 0 ? (
            <p className="muted">Todavía no hay categorías: se crean desde Productos → Categorías.</p>
          ) : (
            <div className={styles.cats}>
              {[...categories]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((c) => (
                  <label key={c.id} className={styles.check}>
                    <input type="checkbox" checked={ids.includes(c.id)} onChange={(e) => setIds((cur) => (e.target.checked ? [...cur, c.id] : cur.filter((x) => x !== c.id)))} />{' '}
                    {c.name}
                  </label>
                ))}
            </div>
          ))}

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

        {sample !== null && (
          <p className={styles.example}>
            Ejemplo: una compra de {formatMoney(EXAMPLE)} con descuento paga <strong>{formatMoney(EXAMPLE - sample)}</strong> (descuento de {formatMoney(sample)}).
          </p>
        )}
        {error && <p className={styles.error}>{error}</p>}
      </div>
    </Modal>
  );
}
