import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useDevice } from '@/contexts/DeviceContext';
import { useToast } from '@/contexts/ToastContext';
import { db } from '@/database/db';
import { localDay } from '@/database/repositories/reports';
import {
  deleteSchedule,
  emptyWeek,
  formatHours,
  listSchedules,
  minutesBetween,
  monthPeriods,
  PAY_PERIODS,
  saveSchedule,
  ScheduleError,
  shiftMinutes,
  weekMinutes,
  WEEKDAYS,
} from '@/database/repositories/schedules';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import type { PayPeriod, Shift, StaffSchedule } from '@/types/domain';
import styles from './SchedulesPage.module.css';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const short = (t: string) => t.replace(/^0(\d)/, '$1');

/** Horarios semanales por sucursal, con las horas de la semana, cada quincena y el mes. */
export function SchedulesPage() {
  const { canSwitchStore } = useAuth();
  const { stores, currentStore } = useDevice();
  const [storeId, setStoreId] = useState(currentStore?.id ?? '');
  const [month, setMonth] = useState(() => localDay(new Date()).slice(0, 7));
  const [editing, setEditing] = useState<StaffSchedule | 'new' | null>(null);

  const schedules = useLiveQuery(() => listSchedules(storeId || null), [storeId], []);
  const p = monthPeriods(month);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const lastDay = p.month[1].getDate();
  const monthName = MONTHS[m - 1] ?? '';
  const shownStores = stores.filter((s) => (storeId ? s.id === storeId : schedules.some((x) => x.store_id === s.id)));

  return (
    <>
      <PageHeader
        title="Horarios"
        subtitle="Turnos de cada semana y horas por período"
        actions={
          <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
            Agregar persona
          </Button>
        }
      />
      <div className={styles.filters}>
        {canSwitchStore && stores.length > 1 && (
          <Select value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Sucursal">
            <option value="">Todas las sucursales</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        )}
        <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Mes" />
      </div>

      {schedules.length === 0 ? (
        <Card>
          <EmptyState icon="calendar" title="Todavía no hay horarios cargados" />
        </Card>
      ) : (
        shownStores.map((store) => {
          const rows = schedules.filter((s) => s.store_id === store.id);
          const sum = (f: (s: StaffSchedule) => number) => rows.reduce((t, s) => t + f(s), 0);
          return (
            <Card key={store.id} title={`Sucursal ${store.name}`} className={styles.storeCard}>
              <div className={styles.scroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Persona</th>
                      {WEEKDAYS.map((d) => (
                        <th key={d}>{d.slice(0, 3)}</th>
                      ))}
                      <th className="num">Semana</th>
                      <th className="num">1 al 15 {monthName.slice(0, 3)}</th>
                      <th className="num">
                        16 al {lastDay} {monthName.slice(0, 3)}
                      </th>
                      <th className="num">
                        {monthName} {y}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => {
                      const pay = s.pay_period;
                      return (
                        <tr key={s.id} onClick={() => setEditing(s)} className={styles.clickable}>
                          <td>
                            <strong>{s.name}</strong>
                            <div>
                              <Badge tone="neutral">Cobra {PAY_PERIODS[pay].toLowerCase()}</Badge>
                            </div>
                          </td>
                          {s.days.map((shifts, i) => (
                            <td key={i} className={styles.day}>
                              {shifts.length === 0 ? (
                                <span className="muted">Franco</span>
                              ) : (
                                shifts.map((sh, j) => (
                                  <div key={j} className="num">
                                    {short(sh.start)}–{short(sh.end)}
                                  </div>
                                ))
                              )}
                            </td>
                          ))}
                          <td className={`num ${pay === 'weekly' ? styles.pay : ''}`}>{formatHours(weekMinutes(s.days))}</td>
                          <td className={`num ${pay === 'biweekly' ? styles.pay : ''}`}>{formatHours(minutesBetween(s.days, ...p.firstHalf))}</td>
                          <td className={`num ${pay === 'biweekly' ? styles.pay : ''}`}>{formatHours(minutesBetween(s.days, ...p.secondHalf))}</td>
                          <td className={`num ${pay === 'monthly' ? styles.pay : ''}`}>{formatHours(minutesBetween(s.days, ...p.month))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {rows.length > 1 && (
                    <tfoot>
                      <tr>
                        <td colSpan={8}>Total de la sucursal</td>
                        <td className="num">{formatHours(sum((s) => weekMinutes(s.days)))}</td>
                        <td className="num">{formatHours(sum((s) => minutesBetween(s.days, ...p.firstHalf)))}</td>
                        <td className="num">{formatHours(sum((s) => minutesBetween(s.days, ...p.secondHalf)))}</td>
                        <td className="num">{formatHours(sum((s) => minutesBetween(s.days, ...p.month)))}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </Card>
          );
        })
      )}
      <p className="muted">Resaltado: las horas del período en que cobra cada persona. Tocá una fila para editarla.</p>

      {editing && <ScheduleModal schedule={editing === 'new' ? null : editing} defaultStore={storeId || currentStore?.id || ''} onClose={() => setEditing(null)} />}
    </>
  );
}

function ScheduleModal({ schedule, defaultStore, onClose }: { schedule: StaffSchedule | null; defaultStore: string; onClose: () => void }) {
  const toast = useToast();
  const { stores } = useDevice();
  const users = useLiveQuery(
    async () => (await db.users.toArray()).filter((u) => u.active && !u.deleted_at).sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [],
    [],
  );
  const [storeId, setStoreId] = useState(schedule?.store_id ?? defaultStore);
  const [userId, setUserId] = useState(schedule?.user_id ?? '');
  const [name, setName] = useState(schedule?.name ?? '');
  const [pay, setPay] = useState<PayPeriod>(schedule?.pay_period ?? 'monthly');
  const [days, setDays] = useState<Shift[][]>(() => schedule?.days.map((d) => d.map((s) => ({ ...s }))) ?? emptyWeek());
  const [notes, setNotes] = useState(schedule?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const setDay = (i: number, shifts: Shift[]) => setDays(days.map((d, j) => (j === i ? shifts : d)));
  const complete = days.every((d) => d.every((s) => s.start && s.end && s.start !== s.end));
  const total = complete ? weekMinutes(days) : null;

  const pickUser = (id: string) => {
    setUserId(id);
    const u = users.find((x) => x.id === id);
    if (u) setName(u.name);
  };

  const copyMonday = () => setDays(days.map((d, i) => (i >= 1 && i <= 4 ? (days[0] ?? []).map((s) => ({ ...s })) : d)));

  const save = async () => {
    setError(null);
    if (!storeId) return setError('Elegí la sucursal');
    try {
      await saveSchedule({ store_id: storeId, user_id: userId || null, name, pay_period: pay, days, notes }, schedule?.id);
      toast('Horario guardado', 'success');
      onClose();
    } catch (e) {
      setError(e instanceof ScheduleError ? e.message : 'No se pudo guardar el horario');
    }
  };

  const remove = async () => {
    if (!schedule) return;
    await deleteSchedule(schedule.id);
    toast('Horario borrado', 'success');
    onClose();
  };

  return (
    <Modal
      open
      title={schedule ? `Horario de ${schedule.name}` : 'Agregar persona'}
      onClose={onClose}
      footer={
        confirmDelete ? (
          <>
            <span className={styles.confirm}>¿Borrar el horario de {schedule?.name}?</span>
            <Button onClick={() => setConfirmDelete(false)}>No</Button>
            <Button variant="danger" onClick={() => void remove()}>
              Sí, borrar
            </Button>
          </>
        ) : (
          <>
            {schedule && (
              <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                Borrar
              </Button>
            )}
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" onClick={() => void save()}>
              Guardar
            </Button>
          </>
        )
      }
    >
      <div className={styles.form}>
        <div className={styles.two}>
          <Field label="Sucursal">
            {(id) => (
              <Select id={id} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                <option value="">Elegí…</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Usuario del sistema" hint="Opcional: si la persona no tiene usuario, escribí sólo el nombre.">
            {(id) => (
              <Select id={id} value={userId} onChange={(e) => pickUser(e.target.value)}>
                <option value="">Sin usuario</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className={styles.two}>
          <Field label="Nombre">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={60} />}</Field>
          <Field label="Cobra">
            {(id) => (
              <Select id={id} value={pay} onChange={(e) => setPay(e.target.value as PayPeriod)}>
                <option value="weekly">Semanal</option>
                <option value="biweekly">Quincenal</option>
                <option value="monthly">Mensual</option>
              </Select>
            )}
          </Field>
        </div>

        <div className={styles.days}>
          <div className={styles.daysHead}>
            <strong>Turnos de la semana</strong>
            <Button size="sm" variant="ghost" onClick={copyMonday} disabled={(days[0] ?? []).length === 0}>
              Copiar el lunes de martes a viernes
            </Button>
          </div>
          {WEEKDAYS.map((label, i) => {
            const shifts = days[i] ?? [];
            return (
              <div key={label} className={styles.dayRow}>
                <span className={styles.dayName}>{label}</span>
                <Button size="sm" icon="plus" onClick={() => setDay(i, [...shifts, { start: shifts.at(-1)?.end ?? '08:00', end: '' }])}>
                  Turno
                </Button>
                <div className={styles.shifts}>
                  {shifts.length === 0 && <span className="muted">Franco</span>}
                  {shifts.map((s, j) => (
                    <div key={j} className={styles.shift}>
                      <Input
                        type="time"
                        value={s.start}
                        aria-label={`${label}, entrada`}
                        onChange={(e) => setDay(i, shifts.map((x, k) => (k === j ? { ...x, start: e.target.value } : x)))}
                      />
                      <span className="muted">a</span>
                      <Input
                        type="time"
                        value={s.end}
                        aria-label={`${label}, salida`}
                        onChange={(e) => setDay(i, shifts.map((x, k) => (k === j ? { ...x, end: e.target.value } : x)))}
                      />
                      <span className="muted num">{s.start && s.end && s.start !== s.end ? formatHours(shiftMinutes(s)) : ''}</span>
                      <Button size="sm" variant="ghost" icon="close" aria-label="Quitar turno" onClick={() => setDay(i, shifts.filter((_, k) => k !== j))} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          <p className={styles.total}>
            Total por semana: <strong>{total === null ? '—' : formatHours(total)}</strong>
          </p>
        </div>

        <Field label="Notas">{(id) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} autoComplete="off" maxLength={200} />}</Field>
        {error && <p className={styles.error}>{error}</p>}
      </div>
    </Modal>
  );
}
