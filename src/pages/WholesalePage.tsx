import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { customerDebts, listCustomers, listWholesaleSales } from '@/database/repositories/wholesale';
import { listStores } from '@/database/repositories/stores';
import { CustomerModal } from '@/components/wholesale/CustomerModal';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, EmptyState } from '@/components/ui/Card';
import { Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatMoney } from '@/services/money';
import type { WholesaleCustomer, WholesaleSale } from '@/types/domain';
import inv from '@/components/inventory/Inventory.module.css';
import styles from './WholesalePage.module.css';

type Status = 'all' | 'owed' | 'paid';

export function statusOf(s: WholesaleSale): { label: string; tone: 'success' | 'warning' | 'neutral' } {
  if (s.voided_at) return { label: 'Anulado', tone: 'neutral' };
  return s.paid_at ? { label: 'Pagado', tone: 'success' } : { label: 'Debe', tone: 'warning' };
}

export function WholesalePage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'clientes' ? 'customers' : 'tickets';
  const setTab = (t: 'tickets' | 'customers') => setParams(t === 'tickets' ? {} : { tab: 'clientes' }, { replace: true });
  const sales = useLiveQuery(listWholesaleSales, [], []);
  const customers = useLiveQuery(listCustomers, [], []);
  const debts = useLiveQuery(customerDebts, [], new Map<string, number>());
  const stores = useLiveQuery(listStores, [], []);
  const storeName = new Map(stores.map((s) => [s.id, s.name]));
  const [status, setStatus] = useState<Status>('all');
  const [customerId, setCustomerId] = useState('');
  // undefined = cerrado, null = cliente nuevo.
  const [editing, setEditing] = useState<WholesaleCustomer | null | undefined>(undefined);

  const shown = sales.filter(
    (s) => (!customerId || s.customer_id === customerId) && (status === 'all' || (!s.voided_at && (status === 'owed' ? !s.paid_at : !!s.paid_at))),
  );
  const owed = [...debts.values()].reduce((t, v) => t + v, 0);

  return (
    <>
      <PageHeader
        title="Mayorista"
        subtitle="Ventas extraordinarias: no tocan el stock, la caja ni las ventas del local"
        actions={
          tab === 'tickets' ? (
            <ButtonLink to="/mayorista/nuevo" variant="primary" icon="plus">Nuevo ticket</ButtonLink>
          ) : (
            <Button variant="primary" icon="plus" onClick={() => setEditing(null)}>Nuevo cliente</Button>
          )
        }
      />
      <div className={inv.tabs} role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'tickets'} className={`${inv.tab} ${tab === 'tickets' ? inv.tabActive : ''}`} onClick={() => setTab('tickets')}>
          Tickets
        </button>
        <button type="button" role="tab" aria-selected={tab === 'customers'} className={`${inv.tab} ${tab === 'customers' ? inv.tabActive : ''}`} onClick={() => setTab('customers')}>
          Clientes
        </button>
      </div>

      {owed > 0 && (
        <p className={styles.owed}>
          Te deben <strong className="num">{formatMoney(owed)}</strong> entre todos los clientes.
        </p>
      )}

      {tab === 'tickets' ? (
        <>
          <div className={styles.filters}>
            <Select value={status} onChange={(e) => setStatus(e.target.value as Status)} aria-label="Estado">
              <option value="all">Todos los tickets</option>
              <option value="owed">Los que deben</option>
              <option value="paid">Pagados</option>
            </Select>
            <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)} aria-label="Cliente">
              <option value="">Todos los clientes</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </div>
          <Card className={inv.table}>
            {shown.length === 0 ? (
              <EmptyState icon="truck" title={sales.length === 0 ? 'Todavía no hay ventas mayoristas' : 'No hay tickets con ese filtro'}>
                {sales.length === 0 ? 'Armá un ticket con tus productos, la cantidad y los precios de esa venta.' : null}
              </EmptyState>
            ) : (
              shown.map((s) => {
                const st = statusOf(s);
                return (
                  <Link key={s.id} to={`/mayorista/${s.id}`} className={`${inv.row} ${s.voided_at ? styles.voided : ''}`}>
                    <span className={inv.rowMain}>
                      <strong>{s.customer_name ?? 'Sin cliente'}</strong>
                      <span className="muted num">
                        {new Date(s.occurred_at).toLocaleDateString('es-AR')} · {s.number} · {s.items.length} {s.items.length === 1 ? 'producto' : 'productos'}
                        {stores.length > 1 && storeName.get(s.store_id) ? ` · ${storeName.get(s.store_id)}` : ''}
                      </span>
                    </span>
                    <span className={`${inv.rowEnd} num`}>
                      {formatMoney(s.total_cents)}
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </span>
                  </Link>
                );
              })
            )}
          </Card>
        </>
      ) : (
        <Card className={inv.table}>
          {customers.length === 0 ? (
            <EmptyState icon="store" title="Todavía no hay clientes">
              Cargalos para adjuntarles cada ticket y saber cuánto te debe cada uno.
            </EmptyState>
          ) : (
            customers.map((c) => {
              const debt = debts.get(c.id) ?? 0;
              return (
                <button key={c.id} type="button" className={inv.row} onClick={() => setEditing(c)}>
                  <span className={inv.rowMain}>
                    <strong>{c.name}</strong>
                    <span className="muted">{[c.phone, c.tax_id, c.address].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</span>
                  </span>
                  <span className={`${inv.rowEnd} num`}>
                    {debt > 0 ? <Badge tone="warning">Debe {formatMoney(debt)}</Badge> : <Badge tone="success">Al día</Badge>}
                  </span>
                </button>
              );
            })
          )}
        </Card>
      )}
      {editing !== undefined && <CustomerModal key={editing?.id ?? 'new'} customer={editing} onClose={() => setEditing(undefined)} />}
    </>
  );
}
