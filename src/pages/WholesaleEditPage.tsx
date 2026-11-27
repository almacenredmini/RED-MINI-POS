import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrentStore } from '@/contexts/DeviceContext';
import { useToast } from '@/contexts/ToastContext';
import { db } from '@/database/db';
import { listStores } from '@/database/repositories/stores';
import { customerDebts, listCustomers, saveWholesaleSale, voidWholesaleSale, WHOLESALE_METHODS, WholesaleError } from '@/database/repositories/wholesale';
import { ProductPicker } from '@/components/inventory/ProductPicker';
import { CustomerModal } from '@/components/wholesale/CustomerModal';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { centsToInput, formatMoney, parseMoney } from '@/services/money';
import { parseQuantity } from '@/services/quantity';
import { printHtml, renderWholesaleHtml } from '@/services/ticket';
import type { WholesaleMethod, WholesaleSale } from '@/types/domain';
import purchase from '@/components/purchases/Purchase.module.css';
import { statusOf } from './WholesalePage';
import styles from './WholesalePage.module.css';

interface Line {
  key: number;
  product_id: string | null;
  name: string;
  quantity: string;
  cost: string;
  price: string;
}

let nextKey = 1;
const qtyOf = (l: Line) => parseQuantity(l.quantity) ?? 0;
const lineTotal = (l: Line) => Math.round(qtyOf(l) * (parseMoney(l.price) ?? 0));
const lineCost = (l: Line) => Math.round(qtyOf(l) * (parseMoney(l.cost) ?? 0));

export function WholesaleEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const store = useCurrentStore();
  const { user } = useAuth();
  const toast = useToast();
  const customers = useLiveQuery(listCustomers, [], []);
  const debts = useLiveQuery(customerDebts, [], new Map<string, number>());
  const stores = useLiveQuery(listStores, [], []);

  const [sale, setSale] = useState<WholesaleSale | null>(null);
  const [loaded, setLoaded] = useState(!id);
  const [customerId, setCustomerId] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [paid, setPaid] = useState(true);
  const [method, setMethod] = useState<WholesaleMethod | null>('cash');
  const [notes, setNotes] = useState('');
  const [newCustomer, setNewCustomer] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    void db.wholesale_sales.get(id).then((s) => {
      if (s && !s.deleted_at) {
        setSale(s);
        setCustomerId(s.customer_id ?? '');
        setLines(s.items.map((i) => ({ key: nextKey++, product_id: i.product_id, name: i.name, quantity: String(i.quantity).replace('.', ','), cost: centsToInput(i.cost_cents), price: centsToInput(i.price_cents) })));
        setPaid(!!s.paid_at);
        setMethod(s.method);
        setNotes(s.notes ?? '');
      }
      setLoaded(true);
    });
  }, [id]);

  if (!loaded) return null;
  if (id && !sale) return <EmptyState icon="alert" title="Ticket no encontrado" />;

  const readOnly = !!sale?.voided_at;
  const customer = customers.find((c) => c.id === customerId) ?? null;
  const total = lines.reduce((t, l) => t + lineTotal(l), 0);
  const cost = lines.reduce((t, l) => t + lineCost(l), 0);
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const back = () => navigate('/mayorista');
  const debt = customer ? (debts.get(customer.id) ?? 0) - (sale && !sale.paid_at && !sale.voided_at && sale.customer_id === customer.id ? sale.total_cents : 0) : 0;

  const print = (s: WholesaleSale) => {
    const from = stores.find((x) => x.id === s.store_id) ?? store;
    const c = customers.find((x) => x.id === s.customer_id) ?? null;
    printHtml(renderWholesaleHtml({ sale: s, storeName: from.name, storeAddress: from.address, customer: c, seller: user?.name ?? null }));
  };

  const save = async (andPrint: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const saved = await saveWholesaleSale(
        {
          store,
          customer: customer ? { id: customer.id, name: customer.name } : sale?.customer_id ? { id: sale.customer_id, name: sale.customer_name ?? '' } : null,
          items: lines.map((l) => ({ product_id: l.product_id, name: l.name, quantity: parseQuantity(l.quantity) ?? 0, cost_cents: parseMoney(l.cost) ?? (l.cost.trim() ? -1 : 0), price_cents: parseMoney(l.price) ?? 0 })),
          method,
          paid,
          notes,
          userId: user?.id ?? null,
        },
        sale?.id,
      );
      if (andPrint) print(saved);
      toast(sale ? 'Ticket actualizado' : `Ticket ${saved.number} guardado`, 'success');
      back();
    } catch (e) {
      setError(e instanceof WholesaleError ? e.message : 'No se pudo guardar el ticket');
      setSaving(false);
    }
  };

  const st = sale ? statusOf(sale) : null;

  return (
    <>
      <PageHeader
        title={sale ? `Ticket ${sale.number}` : 'Nuevo ticket mayorista'}
        subtitle={sale ? `${new Date(sale.occurred_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })} · ${stores.find((x) => x.id === sale.store_id)?.name ?? ''}` : `Sucursal ${store.name}`}
        actions={
          <>
            {st && <Badge tone={st.tone}>{st.label}</Badge>}
            <Button variant="ghost" icon="back" onClick={back}>Volver</Button>
          </>
        }
      />
      <div className={purchase.layout}>
        <p className="muted">Venta extraordinaria: no descuenta stock, no entra en la caja y no suma a las ventas del local. En Reportes aparece aparte.</p>
        {readOnly && <p className={styles.voidedNote}>Este ticket está anulado: no cuenta en ningún lado.</p>}

        <Card title="Cliente">
          <fieldset className={purchase.fields} disabled={readOnly}>
            <Field label="Cliente">
              {(fid) => (
                <div className={styles.customerRow}>
                  <Select id={fid} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                    <option value="">{sale?.customer_name && !customer && sale.customer_id ? sale.customer_name : 'Sin cliente'}</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                  {!readOnly && <Button icon="plus" aria-label="Nuevo cliente" onClick={() => setNewCustomer(true)} />}
                </div>
              )}
            </Field>
          </fieldset>
          {customer && debt > 0 && <p className={styles.below}>Ya debe {formatMoney(debt)} de otros tickets.</p>}
        </Card>

        <Card title="Productos">
          {!readOnly && (
            <ProductPicker
              onPick={(p) => {
                if (lines.some((l) => l.product_id === p.id)) return toast(`${p.name} ya está en el ticket`, 'info');
                setLines((ls) => [...ls, { key: nextKey++, product_id: p.id, name: p.name, quantity: '', cost: p.cost_cents ? centsToInput(p.cost_cents) : '', price: p.price_cents ? centsToInput(p.price_cents) : '' }]);
              }}
            />
          )}
          {lines.length === 0 ? (
            <p className={`muted ${purchase.empty}`}>Buscá o escaneá tus productos. La cantidad, el costo y el precio son los de esta venta: tu stock no cambia.</p>
          ) : (
            <ul className={purchase.lines}>
              {lines.map((l) => {
                const c = parseMoney(l.cost);
                const p = parseMoney(l.price);
                const below = c !== null && p !== null && p > 0 && p < c;
                return (
                  <li key={l.key}>
                    <div className={purchase.lineHead}>
                      <strong>{l.name}</strong>
                      {!readOnly && <Button size="sm" variant="ghost" icon="close" aria-label={`Quitar ${l.name}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} />}
                    </div>
                    <div className={styles.lineFields}>
                      <Field label="Cantidad">{(fid) => <Input id={fid} inputMode="decimal" value={l.quantity} disabled={readOnly} onChange={(e) => update(l.key, { quantity: e.target.value })} autoComplete="off" />}</Field>
                      <Field label="Costo c/u">{(fid) => <Input id={fid} prefix="$" inputMode="decimal" value={l.cost} disabled={readOnly} onChange={(e) => update(l.key, { cost: e.target.value })} autoComplete="off" />}</Field>
                      <Field label="Venta c/u">{(fid) => <Input id={fid} prefix="$" inputMode="decimal" value={l.price} disabled={readOnly} invalid={below} onChange={(e) => update(l.key, { price: e.target.value })} autoComplete="off" />}</Field>
                      <span className={`num ${styles.lineTotal}`}>{formatMoney(lineTotal(l))}</span>
                    </div>
                    {below && <p className={styles.below}>Lo estás vendiendo por debajo del costo.</p>}
                  </li>
                );
              })}
            </ul>
          )}
          <div className={`${styles.sums} num`}>
            <div className="muted">
              <span>Costo</span>
              <span>{formatMoney(cost)}</span>
            </div>
            <div className="muted">
              <span>Ganancia</span>
              <span>{formatMoney(total - cost)}</span>
            </div>
          </div>
          <div className={`${purchase.total} num`}>
            <span>Total</span>
            <strong>{formatMoney(total)}</strong>
          </div>
        </Card>

        <Card title="Pago">
          <fieldset className={styles.pay} disabled={readOnly}>
            <div className={styles.modes} role="radiogroup" aria-label="Estado del pago">
              <button type="button" role="radio" aria-checked={paid} className={paid ? styles.modeActive : styles.mode} onClick={() => setPaid(true)}>
                Pagado
              </button>
              <button type="button" role="radio" aria-checked={!paid} className={!paid ? styles.modeActive : styles.mode} onClick={() => setPaid(false)}>
                Lo debe
              </button>
            </div>
            {paid ? (
              <div className={styles.modes} role="radiogroup" aria-label="Medio de pago">
                {WHOLESALE_METHODS.map((m) => (
                  <button key={m.value} type="button" role="radio" aria-checked={method === m.value} className={method === m.value ? styles.modeActive : styles.mode} onClick={() => setMethod(m.value)}>
                    {m.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">Queda a cuenta del cliente. Cuando te pague, abrí el ticket, marcá Pagado y elegí cómo pagó.</p>
            )}
            <Field label="Notas">{(fid) => <Input id={fid} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional: sale en el ticket" autoComplete="off" />}</Field>
          </fieldset>
        </Card>

        {error && <p className={purchase.error} role="alert">{error}</p>}

        <div className={purchase.actions}>
          {sale && !readOnly &&
            (confirmVoid ? (
              <Button variant="danger" disabled={saving} onClick={() => void voidWholesaleSale(sale.id, user?.id ?? null).then(back)}>
                Sí, anular el ticket
              </Button>
            ) : (
              <Button variant="danger" onClick={() => setConfirmVoid(true)}>Anular</Button>
            ))}
          {sale && (
            <Button icon="pos" onClick={() => print(sale)}>
              Imprimir
            </Button>
          )}
          {!readOnly && (
            <>
              <Button disabled={saving} onClick={() => void save(false)}>
                {sale ? 'Guardar cambios' : 'Guardar'}
              </Button>
              <Button variant="primary" icon="pos" disabled={saving} onClick={() => void save(true)}>
                Guardar e imprimir
              </Button>
            </>
          )}
        </div>
      </div>
      {newCustomer && <CustomerModal customer={null} onSaved={(c) => setCustomerId(c.id)} onClose={() => setNewCustomer(false)} />}
    </>
  );
}
