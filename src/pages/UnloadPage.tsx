import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrentStore } from '@/contexts/DeviceContext';
import { useToast } from '@/contexts/ToastContext';
import { db } from '@/database/db';
import { listStores } from '@/database/repositories/stores';
import { clearUnloaded, listUnloadItems, setUnloadChecked } from '@/database/repositories/unloadItems';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import type { UnloadItem } from '@/types/domain';
import styles from './UnloadPage.module.css';

const qtyText = (n: number) => String(n).replace('.', ',');
const when = (iso: string) => new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 * Mercadería a descargar: lo cargado desde Escanear, separado por sucursal y con casillas.
 * Se ve desde cualquier sucursal; la del dispositivo va primero.
 */
export function UnloadPage() {
  const navigate = useNavigate();
  const store = useCurrentStore();
  const { user } = useAuth();
  const toast = useToast();
  const items = useLiveQuery(listUnloadItems, [], []);
  const stores = useLiveQuery(listStores, [], []);
  const users = useLiveQuery(() => db.users.toArray(), [], []);
  const userName = new Map(users.map((u) => [u.id, u.name]));

  const ordered = [...stores].sort((a, b) => Number(b.id === store.id) - Number(a.id === store.id) || a.name.localeCompare(b.name, 'es'));
  const groups = ordered.map((s) => {
    const rows = items.filter((i) => i.store_id === s.id);
    // Lo pendiente arriba; lo ya descargado abajo, tachado.
    return { store: s, pending: rows.filter((r) => !r.checked_at), done: rows.filter((r) => r.checked_at) };
  });

  const row = (item: UnloadItem) => (
    <li key={item.id}>
      <label className={`${styles.item} ${item.checked_at ? styles.done : ''}`}>
        <input type="checkbox" checked={item.checked_at !== null} onChange={(e) => void setUnloadChecked(item.id, e.target.checked, user?.id ?? null)} />
        <span className={styles.text}>
          <strong>{item.product_name}</strong>
          <span className="muted num">
            Cargado el {when(item.created_at)}
            {item.loaded_by && userName.get(item.loaded_by) ? ` por ${userName.get(item.loaded_by)}` : ''}
          </span>
        </span>
        <span className={`${styles.qty} num`}>{qtyText(item.quantity)}</span>
      </label>
    </li>
  );

  return (
    <>
      <PageHeader
        title="Mercadería a descargar"
        subtitle="Lo que cargaste desde Escanear, separado por local. Tildá lo que ya bajaste."
        actions={
          <Button variant="ghost" icon="back" onClick={() => navigate(-1)}>
            Volver
          </Button>
        }
      />
      <div className={styles.groups}>
        {groups.map(({ store: s, pending, done }) => (
          <Card key={s.id}>
            <div className={styles.head}>
              <h2 className={styles.title}>
                {s.name} {s.id === store.id && <Badge tone="accent">Este local</Badge>}
              </h2>
              <span className="muted">{pending.length === 0 ? 'Nada pendiente' : `${pending.length} por descargar`}</span>
            </div>
            {pending.length + done.length === 0 ? (
              <EmptyState icon="purchases" title="Sin mercadería cargada" />
            ) : (
              <ul className={styles.list}>
                {pending.map(row)}
                {done.map(row)}
              </ul>
            )}
            {done.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                icon="trash"
                onClick={async () => {
                  const n = await clearUnloaded(s.id);
                  toast(`${n} ${n === 1 ? 'producto sacado' : 'productos sacados'} de la lista`, 'success');
                }}
              >
                Sacar de la lista lo ya descargado ({done.length})
              </Button>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
