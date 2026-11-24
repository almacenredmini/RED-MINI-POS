import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useDevice } from '@/contexts/DeviceContext';
import { useToast } from '@/contexts/ToastContext';
import { db } from '@/database/db';
import { localDay } from '@/database/repositories/reports';
import {
  addDays,
  dayKeyOf,
  deleteSchedule,
  emptyWeek,
  formatHours,
  listSchedules,
  mondayOf,
  monthPeriods,
  PAY_PERIODS,
  saveSchedule,
  saveStoreShifts,
  scheduleMinutes,
  scheduleWhatsappText,
  scheduleWhatsappTextByPerson,
  ScheduleError,
  SHIFT_NAMES,
  shiftMinutes,
  shiftOfWeek,
  storeDayOverride,
  weekMinutes,
  weekOf,
  WEEKDAYS,
} from '@/database/repositories/schedules';
import { PersonDayModal, StoreDayModal } from '@/components/schedules/DayChangeModals';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import type { PayPeriod, Shift, ShiftName, StaffSchedule, Store, StoreShiftDay } from '@/types/domain';
import styles from './SchedulesPage.module.css';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const short = (t: string) => t.replace(/^0(\d)/, '$1');
const ddmm = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
const SHIFT_ICON: Record<ShiftName, string> = { morning: '☀️', night: '🌙' };

/** Horarios por sucursal: turnos mañana/noche de cada local que rotan solos semana a semana, horas y envío por WhatsApp. */
export function SchedulesPage() {
  const { canSwitchStore } = useAuth();
  const { stores, currentStore } = useDevice();
  const [storeId, setStoreId] = useState(currentStore?.id ?? '');
  const [monday, setMonday] = useState(() => mondayOf(new Date()));
  const [month, setMonth] = useState(() => localDay(new Date()).slice(0, 7));
  const [editing, setEditing] = useState<StaffSchedule | 'new' | null>(null);
  const [shiftsOpen, setShiftsOpen] = useState(false);
  const [sharing, setSharing] = useState<Store | null>(null);
  const [dayEdit, setDayEdit] = useState<{ store: Store; date: Date; schedule?: StaffSchedule } | null>(null);

  const schedules = useLiveQuery(() => listSchedules(storeId || null), [storeId], []);
  const p = monthPeriods(month);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const lastDay = p.month[1].getDate();
  const monthName = MONTHS[m - 1] ?? '';
  const shownStores = stores.filter((s) => (storeId ? s.id === storeId : schedules.some((x) => x.store_id === s.id)));
  const thisWeek = dayKeyOf(monday) === dayKeyOf(mondayOf(new Date()));

  return (
    <>
      <PageHeader
        title="Horarios"
        subtitle="Turnos de cada semana: el mañana/noche rota solo"
        actions={
          <>
            <Button icon="store" onClick={() => setShiftsOpen(true)}>
              Turnos de los locales
            </Button>
            <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
              Agregar persona
            </Button>
          </>
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
        <div className={styles.week}>
          <Button size="sm" icon="back" aria-label="Semana anterior" onClick={() => setMonday(addDays(monday, -7))} />
          <strong className="num">
            Semana del {ddmm(monday)} al {ddmm(addDays(monday, 6))}
          </strong>
          <Button size="sm" aria-label="Semana siguiente" onClick={() => setMonday(addDays(monday, 7))}>
            ›
          </Button>
          {!thisWeek && (
            <Button size="sm" variant="ghost" onClick={() => setMonday(mondayOf(new Date()))}>
              Esta semana
            </Button>
          )}
        </div>
        <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Mes para las horas" />
      </div>

      {schedules.length === 0 ? (
        <Card>
          <EmptyState icon="calendar" title="Todavía no hay horarios cargados">
            Primero cargá los turnos de cada local (botón Turnos de los locales) y después agregá a cada persona.
          </EmptyState>
        </Card>
      ) : (
        shownStores.map((store) => {
          const rows = schedules.filter((s) => s.store_id === store.id);
          const sum = (f: (s: StaffSchedule) => number) => rows.reduce((t, s) => t + f(s), 0);
          const week = (s: StaffSchedule) => scheduleMinutes(s, store, monday, addDays(monday, 6));
          const between = (s: StaffSchedule, [from, to]: [Date, Date]) => scheduleMinutes(s, store, from, to);
          const missingHours = !store.shift_hours && rows.some((s) => s.rotation);
          return (
            <Card
              key={store.id}
              title={`Sucursal ${store.name}`}
              className={styles.storeCard}
              action={
                rows.length > 0 && (
                  <Button size="sm" variant="primary" onClick={() => setSharing(store)}>
                    Enviar por WhatsApp
                  </Button>
                )
              }
            >
              {missingHours && <p className={styles.error}>Faltan los horarios de los turnos de {store.name}: cargalos en Turnos de los locales.</p>}
              <div className={styles.scroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Persona</th>
                      {WEEKDAYS.map((d, i) => {
                        const date = addDays(monday, i);
                        const special = storeDayOverride(store, date);
                        return (
                          <th key={d}>
                            <button type="button" className={styles.dayHead} title="Feriado u horario especial del local" aria-label={`${d} ${date.getDate()}: feriado u horario especial del local`} onClick={() => setDayEdit({ store, date })}>
                              {d.slice(0, 3)} {date.getDate()}
                              {special && <span className={styles.special}>{special.closed ? 'Cerrado' : special.label || 'Especial'}</span>}
                            </button>
                          </th>
                        );
                      })}
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
                      const shift = s.rotation ? shiftOfWeek(s.rotation, monday) : null;
                      return (
                        <tr key={s.id} onClick={() => setEditing(s)} className={styles.clickable}>
                          <td>
                            <strong>{s.name}</strong>
                            <div className={styles.badges}>
                              {shift ? (
                                <Badge tone={shift === 'morning' ? 'accent' : 'neutral'}>
                                  {SHIFT_ICON[shift]} {SHIFT_NAMES[shift]}
                                  {s.rotation?.rotates ? ' · rota' : ''}
                                </Badge>
                              ) : (
                                <Badge tone="neutral">A medida</Badge>
                              )}
                              <Badge tone="neutral">Cobra {PAY_PERIODS[pay].toLowerCase()}</Badge>
                            </div>
                          </td>
                          {weekOf(s, store, monday).map((shifts, i) => (
                            <td
                              key={i}
                              className={`${styles.day} ${s.overrides?.[dayKeyOf(addDays(monday, i))] ? styles.changed : ''}`}
                              title="Cambiar sólo este día"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDayEdit({ store, date: addDays(monday, i), schedule: s });
                              }}
                            >
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
                          <td className={`num ${pay === 'weekly' ? styles.pay : ''}`}>{formatHours(week(s))}</td>
                          <td className={`num ${pay === 'biweekly' ? styles.pay : ''}`}>{formatHours(between(s, p.firstHalf))}</td>
                          <td className={`num ${pay === 'biweekly' ? styles.pay : ''}`}>{formatHours(between(s, p.secondHalf))}</td>
                          <td className={`num ${pay === 'monthly' ? styles.pay : ''}`}>{formatHours(between(s, p.month))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {rows.length > 1 && (
                    <tfoot>
                      <tr>
                        <td colSpan={8}>Total de la sucursal</td>
                        <td className="num">{formatHours(sum(week))}</td>
                        <td className="num">{formatHours(sum((s) => between(s, p.firstHalf)))}</td>
                        <td className="num">{formatHours(sum((s) => between(s, p.secondHalf)))}</td>
                        <td className="num">{formatHours(sum((s) => between(s, p.month)))}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </Card>
          );
        })
      )}
      <p className="muted">
        Tocá el nombre para editar a la persona, un día para cambiar sólo ese día (franco u otro horario), o el encabezado del día para marcar un feriado del local. Resaltado: las horas del período en que cobra cada persona.
      </p>

      {editing && (
        <ScheduleModal
          schedule={editing === 'new' ? null : editing}
          defaultStore={storeId || currentStore?.id || ''}
          monday={monday}
          onClose={() => setEditing(null)}
        />
      )}
      {dayEdit &&
        (dayEdit.schedule ? (
          <PersonDayModal schedule={dayEdit.schedule} store={dayEdit.store} date={dayEdit.date} onClose={() => setDayEdit(null)} />
        ) : (
          <StoreDayModal store={dayEdit.store} date={dayEdit.date} onClose={() => setDayEdit(null)} />
        ))}
      {shiftsOpen && <StoreShiftsModal initialStore={storeId || currentStore?.id || ''} onClose={() => setShiftsOpen(false)} />}
      {sharing && (
        <WhatsappModal
          byPerson={scheduleWhatsappTextByPerson(
            sharing,
            schedules.filter((s) => s.store_id === sharing.id),
            monday,
          )}
          byDay={scheduleWhatsappText(
            sharing,
            schedules.filter((s) => s.store_id === sharing.id),
            monday,
          )}
          onClose={() => setSharing(null)}
        />
      )}
    </>
  );
}

/** Vista previa del mensaje y envío: en el celular abre el menú de compartir (elegís el grupo); en la PC, WhatsApp Web. */
const FORMAT_KEY = 'horarios.whatsapp';

function WhatsappModal({ byPerson, byDay, onClose }: { byPerson: string; byDay: string; onClose: () => void }) {
  const toast = useToast();
  // Se recuerda en este dispositivo cómo lo mandaste la última vez.
  const [format, setFormat] = useState<'person' | 'day'>(() => {
    try {
      return localStorage.getItem(FORMAT_KEY) === 'day' ? 'day' : 'person';
    } catch {
      return 'person';
    }
  });
  const pick = (f: 'person' | 'day') => {
    setFormat(f);
    try {
      localStorage.setItem(FORMAT_KEY, f);
    } catch {
      /* Sin almacenamiento: sólo vale ahora. */
    }
  };
  const text = format === 'person' ? byPerson : byDay;
  const send = async () => {
    if (navigator.share && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
      try {
        await navigator.share({ text });
        return onClose();
      } catch {
        /* Cancelado: queda abierto. */
        return;
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Texto copiado: pegalo en el grupo', 'success');
    } catch {
      toast('No se pudo copiar', 'error');
    }
  };
  return (
    <Modal
      open
      title="Enviar horarios por WhatsApp"
      onClose={onClose}
      footer={
        <>
          <Button onClick={() => void copy()}>Copiar texto</Button>
          <Button variant="primary" onClick={() => void send()}>
            Abrir WhatsApp
          </Button>
        </>
      }
    >
      <div className={styles.modes} role="radiogroup" aria-label="Cómo armar el mensaje">
        <button type="button" role="radio" aria-checked={format === 'person'} className={format === 'person' ? styles.modeActive : styles.mode} onClick={() => pick('person')}>
          Por cajero
        </button>
        <button type="button" role="radio" aria-checked={format === 'day'} className={format === 'day' ? styles.modeActive : styles.mode} onClick={() => pick('day')}>
          Por día
        </button>
      </div>
      <p className="muted">Se abre WhatsApp con este mensaje: elegí el grupo y mandalo.</p>
      <pre className={styles.preview}>{text}</pre>
    </Modal>
  );
}

const EMPTY_DAY = (): StoreShiftDay => ({ morning: { start: '08:00', end: '15:00' }, night: { start: '15:00', end: '22:00' } });

/** Horario de los turnos mañana y noche de cada local, día por día. */
function StoreShiftsModal({ initialStore, onClose }: { initialStore: string; onClose: () => void }) {
  const toast = useToast();
  const { stores } = useDevice();
  const [storeId, setStoreId] = useState(initialStore || stores[0]?.id || '');
  const store = stores.find((s) => s.id === storeId);
  const [days, setDays] = useState<StoreShiftDay[]>(() => store?.shift_hours?.map((d) => ({ ...d })) ?? Array.from({ length: 7 }, EMPTY_DAY));
  const [error, setError] = useState<string | null>(null);

  const pickStore = (id: string) => {
    setStoreId(id);
    const s = stores.find((x) => x.id === id);
    setDays(s?.shift_hours?.map((d) => ({ ...d })) ?? Array.from({ length: 7 }, EMPTY_DAY));
    setError(null);
  };
  const setShift = (i: number, name: ShiftName, value: Shift | null) => setDays(days.map((d, j) => (j === i ? { ...d, [name]: value } : d)));
  const copyMonday = () => setDays(days.map((d, i) => (i === 0 ? d : { morning: days[0]!.morning && { ...days[0]!.morning }, night: days[0]!.night && { ...days[0]!.night } })));

  const save = async () => {
    setError(null);
    try {
      await saveStoreShifts(storeId, days);
      toast(`Turnos de ${store?.name ?? 'la sucursal'} guardados`, 'success');
      onClose();
    } catch (e) {
      setError(e instanceof ScheduleError ? e.message : 'No se pudieron guardar los turnos');
    }
  };

  const cell = (i: number, name: ShiftName) => {
    const s = days[i]?.[name] ?? null;
    const label = `${WEEKDAYS[i]}, ${SHIFT_NAMES[name].toLowerCase()}`;
    return (
      <div className={styles.storeShift}>
        <label className={styles.check}>
          <input type="checkbox" checked={s !== null} onChange={(e) => setShift(i, name, e.target.checked ? (EMPTY_DAY()[name] as Shift) : null)} />
          {SHIFT_ICON[name]} {SHIFT_NAMES[name]}
        </label>
        {s ? (
          <span className={styles.times}>
            <Input type="time" value={s.start} aria-label={`${label}, entrada`} onChange={(e) => setShift(i, name, { ...s, start: e.target.value })} />
            <span className="muted">a</span>
            <Input type="time" value={s.end} aria-label={`${label}, salida`} onChange={(e) => setShift(i, name, { ...s, end: e.target.value })} />
          </span>
        ) : (
          <span className="muted">No hay</span>
        )}
      </div>
    );
  };

  return (
    <Modal
      open
      title="Turnos de los locales"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!storeId} onClick={() => void save()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <Field label="Sucursal">
          {(id) => (
            <Select id={id} value={storeId} onChange={(e) => pickStore(e.target.value)}>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className={styles.days}>
          <div className={styles.daysHead}>
            <strong>Horario de cada turno</strong>
            <Button size="sm" variant="ghost" onClick={copyMonday}>
              Copiar el lunes a todos los días
            </Button>
          </div>
          {WEEKDAYS.map((label, i) => (
            <div key={label} className={styles.storeDay}>
              <span className={styles.dayName}>{label}</span>
              {cell(i, 'morning')}
              {cell(i, 'night')}
            </div>
          ))}
        </div>
        <p className="muted">Quien hace el turno mañana o noche de este local toma estos horarios. Si los cambiás, se actualizan todos.</p>
        {error && <p className={styles.error}>{error}</p>}
      </div>
    </Modal>
  );
}

function ScheduleModal({ schedule, defaultStore, monday, onClose }: { schedule: StaffSchedule | null; defaultStore: string; monday: Date; onClose: () => void }) {
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
  // Personas nuevas: turno del local, de lunes a sábado, rotando. Las que ya estaban cargadas siguen a medida.
  const [mode, setMode] = useState<'rotation' | 'custom'>(schedule ? (schedule.rotation ? 'rotation' : 'custom') : 'rotation');
  const [workDays, setWorkDays] = useState<number[]>(schedule?.rotation?.work_days ?? [0, 1, 2, 3, 4, 5]);
  const [shift, setShift] = useState<ShiftName>(schedule?.rotation ? shiftOfWeek(schedule.rotation, monday) : 'morning');
  const [rotates, setRotates] = useState(schedule?.rotation?.rotates ?? true);
  const [days, setDays] = useState<Shift[][]>(() => schedule?.days.map((d) => d.map((s) => ({ ...s }))) ?? emptyWeek());
  const [notes, setNotes] = useState(schedule?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const store = stores.find((s) => s.id === storeId);

  const rotation = { work_days: workDays, shift, week: dayKeyOf(monday), rotates };
  const preview = mode === 'rotation' ? weekOf({ ...(schedule ?? ({} as StaffSchedule)), days: emptyWeek(), rotation }, store, monday) : days;

  const setDay = (i: number, shifts: Shift[]) => setDays(days.map((d, j) => (j === i ? shifts : d)));
  const complete = days.every((d) => d.every((s) => s.start && s.end && s.start !== s.end));
  const total = mode === 'rotation' ? weekMinutes(preview) : complete ? weekMinutes(days) : null;

  const pickUser = (id: string) => {
    setUserId(id);
    const u = users.find((x) => x.id === id);
    if (u) setName(u.name);
  };

  const copyMonday = () => setDays(days.map((d, i) => (i >= 1 && i <= 4 ? (days[0] ?? []).map((s) => ({ ...s })) : d)));
  const toggleDay = (i: number) => setWorkDays(workDays.includes(i) ? workDays.filter((d) => d !== i) : [...workDays, i]);

  const save = async () => {
    setError(null);
    if (!storeId) return setError('Elegí la sucursal');
    try {
      await saveSchedule(
        { store_id: storeId, user_id: userId || null, name, pay_period: pay, days, notes, rotation: mode === 'rotation' ? rotation : null },
        schedule?.id,
      );
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

        <div className={styles.modes} role="radiogroup" aria-label="Tipo de horario">
          <button type="button" role="radio" aria-checked={mode === 'rotation'} className={mode === 'rotation' ? styles.modeActive : styles.mode} onClick={() => setMode('rotation')}>
            Turno del local (mañana / noche)
          </button>
          <button type="button" role="radio" aria-checked={mode === 'custom'} className={mode === 'custom' ? styles.modeActive : styles.mode} onClick={() => setMode('custom')}>
            Horario a medida
          </button>
        </div>

        {mode === 'rotation' ? (
          <div className={styles.days}>
            <strong>Días que trabaja</strong>
            <div className={styles.workDays}>
              {WEEKDAYS.map((d, i) => (
                <label key={d} className={styles.check}>
                  <input type="checkbox" checked={workDays.includes(i)} onChange={() => toggleDay(i)} />
                  {d.slice(0, 3)}
                </label>
              ))}
            </div>
            <div className={styles.two}>
              <Field label={`Semana del ${ddmm(monday)} hace`}>
                {(id) => (
                  <Select id={id} value={shift} onChange={(e) => setShift(e.target.value as ShiftName)}>
                    <option value="morning">☀️ Mañana</option>
                    <option value="night">🌙 Noche</option>
                  </Select>
                )}
              </Field>
              <label className={`${styles.check} ${styles.rotates}`}>
                <input type="checkbox" checked={rotates} onChange={(e) => setRotates(e.target.checked)} />
                Cambia de turno cada semana
              </label>
            </div>
            {rotates && (
              <p className="muted num">
                Próximas semanas:{' '}
                {[0, 1, 2, 3]
                  .map((n) => {
                    const w = addDays(monday, 7 * n);
                    const s = shiftOfWeek(rotation, w);
                    return `${ddmm(w)} ${SHIFT_ICON[s]} ${SHIFT_NAMES[s]}`;
                  })
                  .join(' · ')}
              </p>
            )}
            {!store?.shift_hours ? (
              <p className={styles.error}>Todavía no cargaste los turnos de {store?.name ?? 'esta sucursal'}: hacelo en Turnos de los locales.</p>
            ) : (
              <p className="muted num">
                Esta semana:{' '}
                {preview
                  .map((d, i) => (d.length ? `${WEEKDAYS[i]!.slice(0, 3)} ${d.map((s) => `${short(s.start)}–${short(s.end)}`).join(' y ')}` : null))
                  .filter(Boolean)
                  .join(' · ') || 'sin turnos'}
              </p>
            )}
          </div>
        ) : (
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
          </div>
        )}
        <p className={styles.total}>
          Total esta semana: <strong>{total === null ? '—' : formatHours(total)}</strong>
        </p>

        <Field label="Notas">{(id) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} autoComplete="off" maxLength={200} />}</Field>
        {error && <p className={styles.error}>{error}</p>}
      </div>
    </Modal>
  );
}
