import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrentStore, useDevice } from '@/contexts/DeviceContext';
import { cashSummary, difference, getOpenSession, listOpenSessions, listSessions } from '@/database/repositories/cash';
import { dailyCut, recentShifts, shiftCut, type DailyCut } from '@/database/repositories/cut';
import { db } from '@/database/db';
import { PAYMENT_LABELS } from '@/services/payment';
import { printHtml, renderCutHtml } from '@/services/ticket';
import type { PaymentMethod } from '@/types/domain';
import { CashDetail, CashDetailModal, CloseCashModal, DifferenceBadge, MovementList, useUserNames, WithdrawModal } from '@/components/cash/CashModals';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { peekDeviceId } from '@/database/meta';
import { withinTolerance } from '@/services/cashDiff';
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

  // Por turno (una caja, aunque pase la medianoche) o por día calendario.
  const [view, setView] = useState<'shift' | 'day'>('shift');
  const [day, setDay] = useState(() => toInputDate(new Date()));
  const [cashierId, setCashierId] = useState('');
  const [shiftId, setShiftId] = useState('');
  const cashiers = useLiveQuery(
    async () => (await db.users.toArray()).filter((u) => u.active && (u.store_id === null || u.store_id === store.id)).sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [store.id],
    [],
  );
  const shifts = useLiveQuery(() => recentShifts(store.id), [store.id], []);
  // Sin elegir, el turno más reciente.
  const shift = shifts.find((s) => s.id === shiftId) ?? shifts[0];
  const cut = useLiveQuery(
    () => (view === 'shift' ? (shift ? shiftCut(shift.id) : null) : dailyCut(store.id, day, cashierId || null)),
    [view, shift?.id, shift?.closed_at, store.id, day, cashierId],
  );
  const showProfit = can('products.view_cost');
  const dayLabel = new Date(`${day}T00:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const shiftOwner = (s: CashSession) => (s.opened_by ? (names.get(s.opened_by) ?? 'Usuario borrado') : 'Sin usuario');
  const shiftLabel = (s: CashSession) => `${shiftOwner(s)} · ${hour(s.opened_at)} a ${s.closed_at ? hour(s.closed_at) : 'ahora (abierto)'}`;
  const title = view === 'shift' ? (shift ? `Turno de ${shiftLabel(shift)}` : 'Sin turnos') : `Corte del ${dayLabel}`;

  const print = () => {
    if (!cut) return;
    if (view === 'shift' && shift) {
      const range = `${hour(shift.opened_at)} a ${shift.closed_at ? hour(shift.closed_at) : 'ahora'}`;
      printHtml(renderCutHtml({ title: 'CORTE DE TURNO', storeName: store.name, dayLabel: range, cashier: shiftOwner(shift), cut, showProfit }));
    } else {
      printHtml(renderCutHtml({ storeName: store.name, dayLabel, cashier: cashierId ? (cashiers.find((u) => u.id === cashierId)?.name ?? '') : 'Todos', cut, showProfit }));
    }
  };

  return (
    <>
      <PageHeader
        title="Corte"
        subtitle={`Sucursal ${store.name}`}
        actions={
          <>
            <Button icon="reports" onClick={print} disabled={!cut}>
              Imprimir corte
            </Button>
            {open && can('cash.withdraw') && (
              <Button icon="minus" onClick={() => setWithdrawing(true)}>
                Retiro
              </Button>
            )}
            {open && manager && (
              <Button variant="primary" onClick={() => setClosing(open)}>
                Cerrar caja
              </Button>
            )}
          </>
        }
      />

      <div className={styles.filters}>
        <div className={styles.viewSwitch} role="radiogroup" aria-label="Ver corte">
          <button type="button" role="radio" aria-checked={view === 'shift'} className={view === 'shift' ? styles.viewOn : ''} onClick={() => setView('shift')}>
            Por turno
          </button>
          <button type="button" role="radio" aria-checked={view === 'day'} className={view === 'day' ? styles.viewOn : ''} onClick={() => setView('day')}>
            Por día
          </button>
        </div>
        {view === 'shift' ? (
          <label className={`${styles.filter} ${styles.filterWide}`}>
            <span>Turno</span>
            <Select value={shift?.id ?? ''} onChange={(e) => setShiftId(e.target.value)} disabled={shifts.length === 0}>
              {shifts.length === 0 && <option value="">Todavía no hay turnos</option>}
              {shifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {shiftLabel(s)}
                </option>
              ))}
            </Select>
          </label>
        ) : (
          <>
            <label className={styles.filter}>
              <span>Día</span>
              <Input type="date" value={day} max={toInputDate(new Date())} onChange={(e) => e.target.value && setDay(e.target.value)} />
            </label>
            <label className={styles.filter}>
              <span>Del cajero</span>
              <Select value={cashierId} onChange={(e) => setCashierId(e.target.value)}>
                <option value="">Todos</option>
                {cashiers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </label>
          </>
        )}
      </div>

      <h2 className={styles.dayTitle}>{title}</h2>
      {view === 'shift' && <p className="muted">El turno va desde la primera venta del cajero hasta que cierra la caja con "Salir", aunque pase la medianoche.</p>}
      {cut && <CutView cut={cut} showProfit={showProfit} names={names} />}

      <h2 className={styles.dayTitle}>Cajas abiertas</h2>
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

const METHOD_ORDER: PaymentMethod[] = ['cash', 'card', 'debit', 'credit', 'transfer', 'mercadopago'];

function CutView({ cut, showProfit, names }: { cut: DailyCut; showProfit: boolean; names: Map<string, string> }) {
  const line = (label: string, value: number, sign = '') => (
    <div key={label} className={styles.line}>
      <span>{label}</span>
      <span className="num">
        {sign}
        {formatMoney(value)}
      </span>
    </div>
  );
  const methods = METHOD_ORDER.filter((m) => cut.byMethod[m]);
  const account = cut.byMethod.employee_account ?? 0;
  return (
    <>
      <div className={styles.cutGrid}>
        <Card title="Dinero en caja">
          {line('Ventas en efectivo', cut.cashSales, '+ ')}
          {cut.deposits > 0 && line('Entradas', cut.deposits, '+ ')}
          {line('Retiros', cut.withdrawals, '− ')}
          <div className={`${styles.line} ${styles.lineTotal}`}>
            <span>Total</span>
            <span className="num">{formatMoney(cut.cashInDrawer)}</span>
          </div>
          {cut.counted !== undefined &&
            (cut.counted === null ? (
              <p className="muted">Turno abierto: todavía no contó la caja.</p>
            ) : (
              <>
                {line('Contó al cerrar', cut.counted)}
                <div className={styles.line}>
                  <span>Diferencia</span>
                  <DifferenceBadge value={cut.counted - cut.cashInDrawer} />
                </div>
              </>
            ))}
        </Card>

        <Card title="Pagos">
          {methods.length === 0 && account === 0 ? (
            <p className="muted">Sin ventas.</p>
          ) : (
            <>
              {methods.map((m) => line(PAYMENT_LABELS[m], cut.byMethod[m] ?? 0))}
              <div className={`${styles.line} ${styles.lineTotal}`}>
                <span>Cobrado</span>
                <span className="num">{formatMoney(cut.paidNow)}</span>
              </div>
              {account !== 0 && line('A cuenta de empleados', account)}
            </>
          )}
        </Card>

        <Card title="Ventas por categoría">
          {cut.byCategory.length === 0 ? <p className="muted">Sin ventas.</p> : <div className={styles.scrollList}>{cut.byCategory.map((c) => line(c.label, c.total))}</div>}
        </Card>

        <Card title="Retiros y entradas">
          {cut.movements.length === 0 ? (
            <p className="muted">Sin retiros.</p>
          ) : (
            <div className={styles.scrollList}>
              {cut.movements.map((m) => (
                <div key={m.id} className={styles.line}>
                  <span>
                    {m.reason}
                    <span className="muted">
                      {' · '}
                      {new Date(m.occurred_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                      {m.user_id && names.get(m.user_id) ? ` · ${names.get(m.user_id)}` : ''}
                    </span>
                  </span>
                  <span className="num">
                    {m.type === 'withdrawal' ? '− ' : '+ '}
                    {formatMoney(m.amount_cents)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className={styles.totals}>
        <div>
          <span className={styles.totalLabel}>Ventas totales</span>
          <strong className={`num ${styles.totalValue}`}>{formatMoney(cut.salesTotal)}</strong>
          <span className="muted">
            {cut.tickets} {cut.tickets === 1 ? "ticket" : "tickets"}
            {cut.returns.count > 0 && ` · ${cut.returns.count} devoluciones (−${formatMoney(cut.returns.total)})`}
            {cut.voided.count > 0 && ` · ${cut.voided.count} anulados`}
          </span>
        </div>
        {showProfit && (
          <div>
            <span className={styles.totalLabel}>{cut.counted !== undefined ? "Ganancia del turno" : "Ganancia del día"}</span>
            <strong className={`num ${styles.totalValue}`}>{formatMoney(cut.profit)}</strong>
            <span className="muted">Venta − costo de lo vendido</span>
          </div>
        )}
      </div>
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

  const visible = onlyDiff ? sessions.filter(({ session }) => !withinTolerance(difference(session) ?? 0)) : sessions;
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
          <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> Sólo con diferencia (más de $1.000)
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
                    {s.notes && <div className="muted">Nota: {s.notes}</div>}
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
