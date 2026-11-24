import { useState } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { dayKeyOf, formatHours, setScheduleOverride, setStoreOverride, shiftMinutes, shiftsOn, storeDayOverride, ScheduleError, SHIFT_NAMES, WEEKDAYS, weekdayIndex } from '@/database/repositories/schedules';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import type { Shift, ShiftName, StaffSchedule, Store, StoreShiftDay } from '@/types/domain';
import styles from '@/pages/SchedulesPage.module.css';

const short = (t: string) => t.replace(/^0(\d)/, '$1');
const span = (shifts: Shift[]) => (shifts.length ? shifts.map((s) => `${short(s.start)}–${short(s.end)}`).join(' y ') : 'Franco');
const dayTitle = (date: Date) => `${WEEKDAYS[weekdayIndex(date)]} ${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
const SHIFT_ICON: Record<ShiftName, string> = { morning: '☀️', night: '🌙' };

function Choice<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className={styles.modes} role="radiogroup" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map(([v, label]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? styles.modeActive : styles.mode} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function ShiftTimes({ shift, label, onChange }: { shift: Shift; label: string; onChange: (s: Shift) => void }) {
  return (
    <span className={styles.times}>
      <Input type="time" value={shift.start} aria-label={`${label}, entrada`} onChange={(e) => onChange({ ...shift, start: e.target.value })} />
      <span className="muted">a</span>
      <Input type="time" value={shift.end} aria-label={`${label}, salida`} onChange={(e) => onChange({ ...shift, end: e.target.value })} />
    </span>
  );
}

/** Cambio puntual de una persona un día: franco u otro horario. */
export function PersonDayModal({ schedule, store, date, onClose }: { schedule: StaffSchedule; store: Store | undefined; date: Date; onClose: () => void }) {
  const toast = useToast();
  const key = dayKeyOf(date);
  const usual = shiftsOn({ ...schedule, overrides: null }, store, date);
  const current = schedule.overrides?.[key];
  const [mode, setMode] = useState<'usual' | 'off' | 'other'>(current === undefined ? 'usual' : current.length === 0 ? 'off' : 'other');
  const [shifts, setShifts] = useState<Shift[]>(() => (current?.length ? current : usual.length ? usual : [{ start: '08:00', end: '15:00' }]).map((s) => ({ ...s })));
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    try {
      await setScheduleOverride(schedule.id, key, mode === 'usual' ? null : mode === 'off' ? [] : shifts);
      toast('Día cambiado', 'success');
      onClose();
    } catch (e) {
      setError(e instanceof ScheduleError ? e.message : 'No se pudo guardar');
    }
  };

  return (
    <Modal
      open
      title={`${schedule.name} · ${dayTitle(date)}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={() => void save()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <p className="muted num">Normalmente ese día: {span(usual)}</p>
        <Choice value={mode} onChange={setMode} options={[['usual', 'Como siempre'], ['off', 'Franco'], ['other', 'Otro horario']]} />
        {mode === 'other' && (
          <div className={styles.days}>
            {shifts.map((s, j) => (
              <div key={j} className={styles.storeShift}>
                <span>Turno {j + 1}</span>
                <span className={styles.times} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                  <ShiftTimes shift={s} label={`Turno ${j + 1}`} onChange={(v) => setShifts(shifts.map((x, k) => (k === j ? v : x)))} />
                  {shifts.length > 1 && <Button size="sm" variant="ghost" icon="close" aria-label="Quitar turno" onClick={() => setShifts(shifts.filter((_, k) => k !== j))} />}
                </span>
              </div>
            ))}
            <Button size="sm" icon="plus" onClick={() => setShifts([...shifts, { start: shifts.at(-1)?.end ?? '08:00', end: '22:00' }])}>
              Otro turno ese día
            </Button>
            <p className="muted num">
              {shifts.every((s) => s.start && s.end && s.start !== s.end) ? `Total: ${formatHours(shifts.reduce((t, s) => t + shiftMinutes(s), 0))}` : ''}
            </p>
          </div>
        )}
        <p className="muted">Sólo cambia este día. La semana siguiente sigue la rotación de siempre.</p>
        {error && <p className={styles.error}>{error}</p>}
      </div>
    </Modal>
  );
}

/** Día especial del local (feriado): otro horario de turnos para todos los que rotan, o cerrado. */
export function StoreDayModal({ store, date, onClose }: { store: Store; date: Date; onClose: () => void }) {
  const toast = useToast();
  const key = dayKeyOf(date);
  const current = storeDayOverride(store, date);
  const normal: StoreShiftDay = store.shift_hours?.[weekdayIndex(date)] ?? { morning: null, night: null };
  const [mode, setMode] = useState<'normal' | 'special' | 'closed'>(!current ? 'normal' : current.closed ? 'closed' : 'special');
  const [label, setLabel] = useState(current?.label ?? 'Feriado');
  const [hours, setHours] = useState<StoreShiftDay>(() => ({ morning: (current && !current.closed ? current : normal).morning, night: (current && !current.closed ? current : normal).night }));
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    try {
      await setStoreOverride(store.id, key, mode === 'normal' ? null : { ...(mode === 'closed' ? { morning: null, night: null } : hours), closed: mode === 'closed', label });
      toast('Día del local guardado', 'success');
      onClose();
    } catch (e) {
      setError(e instanceof ScheduleError ? e.message : 'No se pudo guardar');
    }
  };

  const cell = (name: ShiftName) => {
    const s = hours[name];
    return (
      <div className={styles.storeShift}>
        <label className={styles.check}>
          <input type="checkbox" checked={s !== null} onChange={(e) => setHours({ ...hours, [name]: e.target.checked ? (normal[name] ?? { start: name === 'morning' ? '08:00' : '15:00', end: name === 'morning' ? '15:00' : '22:00' }) : null })} />
          {SHIFT_ICON[name]} {SHIFT_NAMES[name]}
        </label>
        {s ? <ShiftTimes shift={s} label={SHIFT_NAMES[name]} onChange={(v) => setHours({ ...hours, [name]: v })} /> : <span className="muted">No hay</span>}
      </div>
    );
  };

  return (
    <Modal
      open
      title={`${store.name} · ${dayTitle(date)}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={() => void save()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <Choice value={mode} onChange={setMode} options={[['normal', 'Horario normal'], ['special', 'Horario especial'], ['closed', 'Cerrado']]} />
        {mode !== 'normal' && <Field label="Motivo (sale en el mensaje)">{(id) => <Input id={id} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} autoComplete="off" />}</Field>}
        {mode === 'special' && (
          <div className={styles.days}>
            {cell('morning')}
            {cell('night')}
          </div>
        )}
        <p className="muted">
          {mode === 'closed'
            ? 'Ese día nadie trabaja en el local.'
            : 'Los que hacen el turno mañana o noche toman este horario ese día. Los cambios puntuales de cada persona se respetan.'}
        </p>
        {error && <p className={styles.error}>{error}</p>}
      </div>
    </Modal>
  );
}
