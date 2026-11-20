import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCurrentStore } from '@/contexts/DeviceContext';
import { listPurchases } from '@/database/repositories/purchases';
import { listStores } from '@/database/repositories/stores';
import { listSuppliers } from '@/database/repositories/suppliers';
import { listInvoices } from '@/database/repositories/supplierInvoices';
import { SupplierModal } from '@/components/purchases/SupplierModal';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, EmptyState } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatMoney } from '@/services/money';
import type { PurchaseStatus, Supplier } from '@/types/domain';
import styles from '@/components/inventory/Inventory.module.css';

type Tab = 'purchases' | 'invoices' | 'suppliers';

const STATUS: Record<PurchaseStatus, { label: string; tone: 'accent' | 'success' | 'neutral' }> = {
  draft: { label: 'Borrador', tone: 'accent' },
  received: { label: 'Recibida', tone: 'success' },
  cancelled: { label: 'Cancelada', tone: 'neutral' },
};

export function PurchasesPage() {
  const store = useCurrentStore();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'boletas' ? 'invoices' : params.get('tab') === 'proveedores' ? 'suppliers' : 'purchases';
  const setTab = (t: Tab) => setParams(t === 'purchases' ? {} : { tab: t === 'invoices' ? 'boletas' : 'proveedores' }, { replace: true });
  // Las boletas se comparten: se ven las de los dos locales, cada una con su sucursal.
  const invoices = useLiveQuery(() => listInvoices(null), [], []);
  const stores = useLiveQuery(listStores, [], []);
  const storeName = new Map(stores.map((s) => [s.id, s.name]));
  // undefined = cerrado, null = proveedor nuevo.
  const [editing, setEditing] = useState<Supplier | null | undefined>(undefined);
  const purchases = useLiveQuery(() => listPurchases(store.id), [store.id], []);
  const suppliers = useLiveQuery(listSuppliers, [], []);
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));

  return (
    <>
      <PageHeader
        title="Compras"
        subtitle={`Sucursal ${store.name}`}
        actions={
          tab === 'purchases' ? (
            <ButtonLink to="/compras/nueva" variant="primary" icon="plus">Nueva compra</ButtonLink>
          ) : tab === 'invoices' ? (
            <ButtonLink to="/compras/boletas/nueva" variant="primary" icon="plus">Nueva boleta</ButtonLink>
          ) : (
            <Button variant="primary" icon="plus" onClick={() => setEditing(null)}>Nuevo proveedor</Button>
          )
        }
      />
      <div className={styles.tabs} role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'purchases'} className={`${styles.tab} ${tab === 'purchases' ? styles.tabActive : ''}`} onClick={() => setTab('purchases')}>
          Compras
        </button>
        <button type="button" role="tab" aria-selected={tab === 'invoices'} className={`${styles.tab} ${tab === 'invoices' ? styles.tabActive : ''}`} onClick={() => setTab('invoices')}>
          Boletas
        </button>
        <button type="button" role="tab" aria-selected={tab === 'suppliers'} className={`${styles.tab} ${tab === 'suppliers' ? styles.tabActive : ''}`} onClick={() => setTab('suppliers')}>
          Proveedores
        </button>
      </div>

      <Card className={styles.table}>
        {tab === 'invoices' ? (
          invoices.length === 0 ? (
            <EmptyState icon="purchases" title="Todavía no hay boletas">
              Guardá las boletas de tus proveedores para tener el control. No cambian el stock ni los costos.
            </EmptyState>
          ) : (
            invoices.map((inv) => {
              return (
                <Link key={inv.id} to={`/compras/boletas/${inv.id}`} className={styles.row}>
                  <span className={styles.rowMain}>
                    <strong>{inv.supplier_name}</strong>
                    <span className="muted num">
                      {inv.issued_on ? new Date(`${inv.issued_on}T12:00`).toLocaleDateString('es-AR') : 'Sin fecha'}
                      {inv.number ? ` · ${inv.number}` : ''} · {inv.items.length} artículos
                      {stores.length > 1 && storeName.get(inv.store_id) ? ` · ${storeName.get(inv.store_id)}` : ''}
                    </span>
                  </span>
                  <span className={`${styles.rowEnd} num`}>
                    {inv.total_cents !== null ? formatMoney(inv.total_cents) : ''}
                  </span>
                </Link>
              );
            })
          )
        ) : tab === 'purchases' ? (
          purchases.length === 0 ? (
            <EmptyState icon="purchases" title="Todavía no hay compras" />
          ) : (
            purchases.map((p) => (
              <Link key={p.id} to={`/compras/${p.id}`} className={styles.row}>
                <span className={styles.rowMain}>
                  <strong>{(p.supplier_id && supplierName.get(p.supplier_id)) ?? 'Sin proveedor'}</strong>
                  <span className="muted num">
                    {new Date(p.received_at ?? p.created_at).toLocaleDateString('es-AR')}
                    {p.invoice_number ? ` · ${p.invoice_type ?? ''} ${p.invoice_number}` : ''}
                  </span>
                </span>
                <span className={`${styles.rowEnd} num`}>
                  {formatMoney(p.total_cents)}
                  <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>
                </span>
              </Link>
            ))
          )
        ) : suppliers.length === 0 ? (
          <EmptyState icon="store" title="Todavía no hay proveedores" />
        ) : (
          suppliers.map((s) => (
            <button key={s.id} type="button" className={styles.row} onClick={() => setEditing(s)}>
              <span className={styles.rowMain}>
                <strong>{s.name}</strong>
                <span className="muted">{[s.tax_id, s.phone, s.email].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</span>
              </span>
            </button>
          ))
        )}
      </Card>
      {editing !== undefined && <SupplierModal key={editing?.id ?? 'new'} supplier={editing} onClose={() => setEditing(undefined)} />}
    </>
  );
}
