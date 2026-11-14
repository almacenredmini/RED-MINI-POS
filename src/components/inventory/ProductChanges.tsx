import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/database/db';
import { listProductChanges } from '@/database/repositories/productChanges';
import { localDay } from '@/database/repositories/reports';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Field';
import { formatMoney } from '@/services/money';
import type { ProductChange, ProductChangeAction, ProductChangeSource } from '@/types/domain';
import styles from './ProductTools.module.css';

const ACTIONS: Record<ProductChangeAction, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  created: { label: 'Agregado', tone: 'success' },
  updated: { label: 'Modificado', tone: 'warning' },
  deleted: { label: 'Borrado', tone: 'danger' },
};

const SOURCES: Record<ProductChangeSource, string> = {
  manual: 'A mano',
  import: 'Importación de Excel',
  purchase: 'Compra',
  bulk_price: 'Cambio de precios en lote',
};

const FIELDS: Record<string, string> = {
  name: 'Nombre',
  brand: 'Marca',
  category_id: 'Categoría',
  unit: 'Unidad',
  cost_cents: 'Costo',
  price_cents: 'Precio',
  active: 'Activo',
  barcodes: 'Códigos',
};

const UNITS: Record<string, string> = { unit: 'Unidad', kg: 'Kilogramo' };

const shiftDay = (day: string, delta: number) => {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return localDay(d);
};

/** Reporte de movimientos: altas, modificaciones y bajas de productos, día por día. */
export function ProductChangesTab() {
  const { can } = useAuth();
  const showCost = can('products.view_cost');
  const today = localDay(new Date());
  const [day, setDay] = useState(today);
  const [action, setAction] = useState<ProductChangeAction | ''>('');

  const start = new Date(`${day}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const rows = useLiveQuery(() => listProductChanges(start.toISOString(), end.toISOString()), [day], []);
  const users = useLiveQuery(async () => new Map((await db.users.toArray()).map((u) => [u.id, u.name])), [], new Map<string, string>());
  const categories = useLiveQuery(async () => new Map((await db.categories.toArray()).map((c) => [c.id, c.name])), [], new Map<string, string>());

  const format = (field: string, value: unknown): string => {
    if (value === null || value === undefined || value === '') return '—';
    if (field === 'cost_cents' || field === 'price_cents') return formatMoney(Number(value));
    if (field === 'category_id') return categories.get(String(value)) ?? 'Sin categoría';
    if (field === 'unit') return UNITS[String(value)] ?? String(value);
    if (field === 'active') return value ? 'Sí' : 'No';
    return String(value);
  };

  // Sin permiso para ver costos, los cambios de costo no se muestran.
  const visible = (c: ProductChange) => Object.entries(c.changes).filter(([field]) => showCost || field !== 'cost_cents');
  const counts = (a: ProductChangeAction) => rows.filter((c) => c.action === a && (a !== 'updated' || visible(c).length > 0)).length;
  const shown = rows.filter((c) => (!action || c.action === action) && (c.action !== 'updated' || visible(c).length > 0));
  const total = counts('created') + counts('updated') + counts('deleted');

  return (
    <>
      <div className={styles.filters}>
        <div className={styles.dayPicker}>
          <Button size="sm" aria-label="Día anterior" onClick={() => setDay(shiftDay(day, -1))}>
            ‹
          </Button>
          <Input type="date" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Día" />
          <Button size="sm" aria-label="Día siguiente" disabled={day >= today} onClick={() => setDay(shiftDay(day, 1))}>
            ›
          </Button>
          {day !== today && (
            <Button size="sm" variant="ghost" onClick={() => setDay(today)}>
              Hoy
            </Button>
          )}
        </div>
        <Select value={action} onChange={(e) => setAction(e.target.value as ProductChangeAction | '')} aria-label="Tipo de movimiento">
          <option value="">Todos ({total})</option>
          <option value="created">Agregados ({counts('created')})</option>
          <option value="updated">Modificados ({counts('updated')})</option>
          <option value="deleted">Borrados ({counts('deleted')})</option>
        </Select>
      </div>

      <Card className={styles.table}>
        {shown.length === 0 ? (
          <EmptyState icon="inventory" title="Sin movimientos de productos ese día" />
        ) : (
          shown.map((c) => (
            <div key={c.id} className={styles.change}>
              <div className={styles.changeHead}>
                <strong>{c.product_name}</strong>
                <Badge tone={ACTIONS[c.action].tone}>{ACTIONS[c.action].label}</Badge>
              </div>
              {c.action === 'updated' && (
                <ul className={styles.fields}>
                  {visible(c).map(([field, [from, to]]) => (
                    <li key={field}>
                      <span className="muted">{FIELDS[field] ?? field}:</span> {format(field, from)} → <strong>{format(field, to)}</strong>
                    </li>
                  ))}
                </ul>
              )}
              <span className="muted num">
                {new Date(c.occurred_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                {c.user_id && users.get(c.user_id) ? ` · ${users.get(c.user_id)}` : ''} · {SOURCES[c.source]}
              </span>
            </div>
          ))
        )}
      </Card>
    </>
  );
}
