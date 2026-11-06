import { useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/database/db';
import { ensureCategory, listCategories } from '@/database/repositories/categories';
import { listProductCosts } from '@/database/repositories/costs';
import type { ProductInput } from '@/database/repositories/products';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrentStore } from '@/contexts/DeviceContext';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Field';
import type { ProductUnit } from '@/types/domain';
import { formatMoney } from '@/services/money';
import { BarcodeEditor } from './BarcodeEditor';
import { ImagePicker } from './ImagePicker';
import { PricingFields } from './PricingFields';
import styles from './ProductForm.module.css';

export interface ProductFormValues extends Omit<ProductInput, 'image' | 'stock_adjustment'> {
  image: Blob | null;
  /** Unidades que entran (+) o salen (-) al guardar. */
  stock_delta: number;
}

/** Acepta "+5", "-3" y "1,5". Vacío = sin ajuste; null = no es un número. */
function parseDelta(text: string): number | null {
  const clean = text.trim().replace(',', '.');
  if (clean === '') return 0;
  const value = Number(clean);
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}

interface Props {
  initial: ProductFormValues;
  productId?: string | undefined;
  submitting: boolean;
  onSubmit: (values: ProductFormValues, imageChanged: boolean) => void;
  footer?: React.ReactNode;
}

const NEW_CATEGORY = '__new__';

export function ProductForm({ initial, productId, submitting, onSubmit, footer }: Props) {
  const { can } = useAuth();
  const store = useCurrentStore();
  const autoMin = useLiveQuery(() => (productId ? db.store_min_stock.get(`${store.id}:${productId}`) : undefined), [productId, store.id]);
  const currentStock = useLiveQuery(async () => (productId ? ((await db.stock.get(`${store.id}:${productId}`))?.quantity ?? 0) : 0), [productId, store.id], 0);
  const [v, setV] = useState(initial);
  const [imageChanged, setImageChanged] = useState(false);
  const [newCategory, setNewCategory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deltaText, setDeltaText] = useState('');
  const delta = parseDelta(deltaText);
  const costs = useLiveQuery(() => (productId && can('products.view_cost') ? listProductCosts(productId) : []), [productId, can], []);

  const step = (by: number) => {
    const next = (delta ?? 0) + by;
    setDeltaText(next === 0 ? '' : next > 0 ? `+${next}` : String(next));
  };

  const categories = useLiveQuery(listCategories, [], []);

  const set = <K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) => setV((s) => ({ ...s, [key]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!v.name.trim()) return setError('El nombre es obligatorio');
    if (v.price_cents <= 0) return setError('Ingresá un precio de venta');
    if (delta === null) return setError('El ajuste de stock tiene que ser un número, por ejemplo +5 o -3');
    setError(null);

    let categoryId = v.category_id;
    if (newCategory?.trim()) categoryId = (await ensureCategory(newCategory)).id;
    onSubmit({ ...v, category_id: categoryId, stock_delta: delta }, imageChanged);
  };

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <div className={styles.columns}>
        <div className={styles.colMain}>
          <Card title="Datos">
            <div className={styles.grid}>
              <Field label="Nombre" className={styles.span2}>
                {(id) => <Input id={id} value={v.name} onChange={(e) => set('name', e.target.value)} placeholder="Ej: Fernet Branca 750 ml" autoFocus={!initial.name} />}
              </Field>
              {can('stock.adjust') && (
                <Field
                  label="Ajuste de stock (+ o −)"
                  error={delta === null ? 'Tiene que ser un número' : null}
                  hint={`En ${store.name}: ${currentStock}${delta ? ` → queda en ${Math.round((currentStock + delta) * 1000) / 1000}` : ''}`}
                >
                  {(id) => (
                    <div className={styles.stepper}>
                      <Button icon="minus" aria-label="Restar una unidad" onClick={() => step(-1)} />
                      <Input id={id} value={deltaText} onChange={(e) => setDeltaText(e.target.value)} placeholder="+5 o -3" autoComplete="off" onFocus={(e) => e.target.select()} />
                      <Button icon="plus" aria-label="Sumar una unidad" onClick={() => step(1)} />
                    </div>
                  )}
                </Field>
              )}
              <Field label="Categoría">
                {(id) =>
                  newCategory === null ? (
                    <Select
                      id={id}
                      value={v.category_id ?? ''}
                      onChange={(e) => (e.target.value === NEW_CATEGORY ? setNewCategory('') : set('category_id', e.target.value || null))}
                    >
                      <option value="">Sin categoría</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                      <option value={NEW_CATEGORY}>+ Nueva categoría…</option>
                    </Select>
                  ) : (
                    <div className={styles.inline}>
                      <Input id={id} autoFocus value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Nombre de la categoría" />
                      <Button icon="close" onClick={() => setNewCategory(null)} aria-label="Cancelar" />
                    </div>
                  )
                }
              </Field>
              <Field label="Código interno (SKU)">
                {(id) => <Input id={id} value={v.sku ?? ''} onChange={(e) => set('sku', e.target.value)} />}
              </Field>
              <Field label="Unidad">
                {(id) => (
                  <Select id={id} value={v.unit} onChange={(e) => set('unit', e.target.value as ProductUnit)}>
                    <option value="unit">Unidad</option>
                    <option value="kg">Kilogramo</option>
                    <option value="l">Litro</option>
                  </Select>
                )}
              </Field>
              <Field label="Códigos de barras" className={styles.span2}>
                {(id) => <BarcodeEditor id={id} codes={v.barcodes} onChange={(codes) => set('barcodes', codes)} />}
              </Field>
            </div>
          </Card>

          <Card title="Precio">
            <PricingFields
              cost={v.cost_cents}
              price={v.price_cents}
              showCost={can('products.view_cost')}
              canEdit={can('products.edit_price')}
              onChange={({ cost, price }) => setV((s) => ({ ...s, cost_cents: cost, price_cents: price }))}
            />
          </Card>
        </div>

        <div className={styles.colSide}>
          <Card title="Imagen">
            <ImagePicker
              value={v.image}
              onChange={(blob) => {
                set('image', blob);
                setImageChanged(true);
              }}
            />
          </Card>
          {costs.length > 0 && (
            <Card title="Costos históricos">
              <ul className={styles.costs}>
                {costs.map((c) => (
                  <li key={c.id} className="num">
                    <span className="muted">{new Date(c.effective_at).toLocaleDateString('es-AR')}</span>
                    <strong>{formatMoney(c.cost_cents)}</strong>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="Control">
            <div className={styles.grid1}>
              <label className={styles.toggle}>
                <input type="checkbox" checked={v.auto_min_stock} onChange={(e) => set('auto_min_stock', e.target.checked)} />
                <span>Ajustar el mínimo cada semana según las ventas</span>
              </label>
              {v.auto_min_stock && autoMin && (
                <p className="muted num">
                  Hoy en {store.name}: mínimo {autoMin.min_stock} (vende {Math.round(autoMin.weekly_avg * 10) / 10} por semana)
                </p>
              )}
              <Field
                label={v.auto_min_stock ? 'Stock mínimo inicial' : 'Stock mínimo'}
                hint={v.auto_min_stock ? 'Se usa hasta que el producto tenga ventas en la sucursal.' : 'Alerta cuando el stock llegue a este valor.'}
              >
                {(id) => (
                  <Input id={id} type="number" min={0} inputMode="numeric" placeholder="0" value={v.min_stock || ''} onFocus={(e) => e.target.select()} onChange={(e) => set('min_stock', Math.max(0, Number(e.target.value) || 0))} />
                )}
              </Field>
              <label className={styles.toggle}>
                <input type="checkbox" checked={v.active} onChange={(e) => set('active', e.target.checked)} />
                <span>Activo para la venta</span>
              </label>
            </div>
          </Card>
        </div>
      </div>

      <div className={styles.actions}>
        {error && <span className={styles.formError}>{error}</span>}
        {footer}
        <Button type="submit" variant="primary" size="lg" disabled={submitting}>
          {submitting ? 'Guardando…' : 'Guardar producto'}
        </Button>
      </div>
    </form>
  );
}
