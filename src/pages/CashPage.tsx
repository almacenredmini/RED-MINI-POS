import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrentStore, useDevice } from '@/contexts/DeviceContext';
import { cashSummary, difference, getOpenSession, listOpenSessions, listSessions } from '@/database/repositories/cash';
import { CashDetail, CashDetailModal, CloseCashModal, DifferenceBadge, MovementList, useUserNames, WithdrawModal } from '@/components/cash/CashModals';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { peekDeviceId } from '@/database/meta';
import { formatMoney } from '@/services/money';
import type { CashSession } from '@/types/domain';
import styles from './CashPage.module.css';

const toInputDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hour = (iso: string) => new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function CashPage() {
  const { user, can } = useAuth();
  const store = useCurrentStore();
  const names = useUserNames();
  const manager = can('cash.manage');
  const open = useLiveQuery(() => getOpenSession(), []);
  const summary = useLiveQuery(() => (open ? cashSummary(open.id) : undefined), [open?.id]);
  const [withdrawing, setWithdrawing] = useState(false);
  const [closing, setClosing] = useState<CashSession | null>(null);

  const mine = open && open.opened_by === user?.id;
  const ownMovements = summary?.movements.filter((m) => manager || m.user_id === user?.id) ?? [];

  return (
    <>
      <PageHeader
        title="Caja"
        subtitle="De este dispositivo"
        actions={
          open && (
            <>
              {can('cash.withdraw') && (
                <Button icon="minus" onClick={() => setWithdrawing(true)}>
                  Retiro
                </Button>
              )}
              {manager && (
                <Button variant="primary" onClick={() => setClosing(open)}>
                  Cerrar caja
                </Button>
              )}
            </>
          )
        }
      />

      <div className={styles.grid}>
        <Card title="Caja actual" action={open ? <Badge tone="success" dot>Abierta</Badge> : <Badge>Sin abrir</Badge>}>
          {!open ? (
            <p className="muted">La caja se abre sola con la primera venta, en $0.</p>
          ) : manager && summary ? (
            <CashDetail summary={summary} />
          ) : (
            <div className={styles.cashier}>
              <p>
                Abierta por <strong>{open.opened_by ? names.get(open.opened_by) : '—'}</strong> el {hour(open.opened_at)}
              </p>
              {mine && <p className="muted">Para cerrarla, tocá "Salir": te va a pedir que cuentes el efectivo.</p>}
              {ownMovements.length > 0 && (
                <>
                  <h3 className={styles.subtitle}>Tus retiros</h3>
                  <MovementList movements={ownMovements} names={names} />
                </>
              )}
            </div>
          )}
        </Card>

        {manager && <OtherCashes storeId={store.id} />}
      </div>

      {manager && <CashHistory />}

      {withdrawing && open && <WithdrawModal session={open} onClose={() => setWithdrawing(false)} />}
      {closing && <CloseCashModal session={closing} onCancel={() => setClosing(null)} onClosed={() => setClosing(null)} />}
    </>
  );
}

/** Cajas abiertas en otros dispositivos de la sucursal (llegan por sincronización). */
function OtherCashes({ storeId }: { storeId: string }) {
  const names = useUserNames();
  const [openId, setOpenId] = useState<string | null>(null);
  const others = useLiveQuery(async () => {
    const device = await peekDeviceId();
    return (await listOpenSessions(storeId)).filter((s) => s.device_id !== device);
  }, [storeId], []);
  if (others.length === 0) return null;
  return (
    <Card title="Abiertas en otros dispositivos">
      <ul className={styles.rows}>
        {others.map((s) => (
          <li key={s.id}>
            <button type="button" className={styles.row} onClick={() => setOpenId(s.id)}>
              <span>{s.opened_by ? names.get(s.opened_by) : '—'}</span>
              <span className="muted num">Desde {hour(s.opened_at)}</span>
            </button>
          </li>
        ))}
      </ul>
      {openId && <CashDetailModal sessionId={openId} onClose={() => setOpenId(null)} />}
    </Card>
  );
}

function CashHistory() {
  const { stores, currentStore } = useDevice();
  const { canSwitchStore } = useAuth();
  const names = useUserNames();
  const [from, setFrom] = useState(() => toInputDate(new Date(Date.now() - 6 * 86_400_000)));
  const [to, setTo] = useState(() => toInputDate(new Date()));
  const [storeId, setStoreId] = useState<string>(currentStore?.id ?? '');
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const sessions = useLiveQuery(async () => {
    const start = new Date(`${from}T00:00:00`).toISOString();
    const end = new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000).toISOString();
    const rows = await listSessions(storeId || null, start, end);
    return Promise.all(rows.map(async (s) => ({ session: s, summary: await cashSummary(s.id) })));
  }, [from, to, storeId], []);

  const visible = onlyDiff ? sessions.filter(({ session }) => (difference(session) ?? 0) !== 0) : sessions;
  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? '';

  return (
    <Card title="Historial de cajas" className={styles.history}>
      <div className={styles.filters}>
        <Input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="Desde" />
        <Input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="Hasta" />
        {canSwitchStore && (
          <Select value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Sucursal">
            <option value="">Todas las sucursales</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        )}
        <label className={styles.check}>
          <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> Sólo con diferencia
        </label>
      </div>
      {visible.length === 0 ? (
        <EmptyState icon="cash" title="No hay cajas en estas fechas" />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Cajero</th>
                {!storeId && <th>Sucursal</th>}
                <th>Apertura</th>
                <th>Cierre</th>
                <th className="num">Ventas</th>
                <th className="num">Esperado</th>
                <th className="num">Contado</th>
                <th>Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ session: s, summary }) => (
                <tr key={s.id} onClick={() => setOpenId(s.id)}>
                  <td>{s.opened_by ? names.get(s.opened_by) : '—'}</td>
                  {!storeId && <td>{storeName(s.store_id)}</td>}
                  <td className="num">{hour(s.opened_at)}</td>
                  <td className="num">{s.closed_at ? hour(s.closed_at) : '—'}</td>
                  <td className="num">{summary ? formatMoney(summary.total) : ''}</td>
                  <td className="num">{s.expected_cents !== null ? formatMoney(s.expected_cents) : ''}</td>
                  <td className="num">{s.counted_cents !== null ? formatMoney(s.counted_cents) : ''}</td>
                  <td>
                    <DifferenceBadge value={difference(s)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {openId && <CashDetailModal sessionId={openId} onClose={() => setOpenId(null)} />}
    </Card>
  );
}
