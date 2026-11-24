import { db } from '../db';
import { getDeviceId } from '../meta';
import { enqueue, newMeta, touchMeta } from '../outbox';
import { nowISO, uuidv7 } from '@/services/id';
import type { PayPeriod, Rotation, Shift, ShiftName, StaffSchedule, Store, StoreDayOverride, StoreShiftDay, UUID } from '@/types/domain';

export const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'] as const;
export const PAY_PERIODS: Record<PayPeriod, string> = { weekly: 'Semanal', biweekly: 'Quincenal', monthly: 'Mensual' };

export class ScheduleError extends Error {}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Duración de un turno en minutos. Si termina antes de empezar, cruza la medianoche (ej.: 18:00 a 02:00). */
export function shiftMinutes({ start, end }: Shift): number {
  const diff = minutesOf(end) - minutesOf(start);
  return diff > 0 ? diff : diff + 24 * 60;
}

export const dayMinutes = (shifts: Shift[]) => shifts.reduce((t, s) => t + shiftMinutes(s), 0);
export const weekMinutes = (days: Shift[][]) => days.reduce((t, d) => t + dayMinutes(d), 0);

/** Lunes = 0 … domingo = 6. */
export const weekdayIndex = (d: Date) => (d.getDay() + 6) % 7;

/** Minutos trabajados entre dos fechas (ambas incluidas), repitiendo el horario semanal. */
export function minutesBetween(days: Shift[][], from: Date, to: Date): number {
  let total = 0;
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const last = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (d <= last) {
    total += dayMinutes(days[weekdayIndex(d)] ?? []);
    d.setDate(d.getDate() + 1);
  }
  return total;
}

export const SHIFT_NAMES: Record<ShiftName, string> = { morning: 'Mañana', night: 'Noche' };
export const otherShift = (s: ShiftName): ShiftName => (s === 'morning' ? 'night' : 'morning');

/** `AAAA-MM-DD` en hora local. */
export const dayKeyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parseDayKey = (key: string) => {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
};
/** Lunes de la semana de `d`, a la medianoche. */
export function mondayOf(d: Date): Date {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - weekdayIndex(m));
  return m;
}
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** El turno que le toca la semana que empieza en `monday`: si rota, cambia una semana sí y otra no. */
export function shiftOfWeek(r: Rotation, monday: Date): ShiftName {
  if (!r.rotates) return r.shift;
  const weeks = Math.round((mondayOf(monday).getTime() - parseDayKey(r.week).getTime()) / (7 * 86_400_000));
  return Math.abs(weeks) % 2 === 0 ? r.shift : otherShift(r.shift);
}

type StoreHours = Pick<Store, 'shift_hours' | 'shift_overrides'>;

/** El día especial del local en esa fecha (feriado), si hay. */
export const storeDayOverride = (store: StoreHours | undefined, date: Date): StoreDayOverride | undefined => store?.shift_overrides?.[dayKeyOf(date)];

/**
 * Turnos de una persona un día puntual. Orden: su cambio puntual de ese día; si el local está cerrado, nada;
 * si rota, el turno del local (el horario especial de ese día, si hay); si no, su horario a medida.
 */
export function shiftsOn(schedule: StaffSchedule, store: StoreHours | undefined, date: Date): Shift[] {
  const own = schedule.overrides?.[dayKeyOf(date)];
  if (own) return own;
  const special = storeDayOverride(store, date);
  if (special?.closed) return [];
  const i = weekdayIndex(date);
  const r = schedule.rotation;
  if (!r) return schedule.days[i] ?? [];
  if (!r.work_days.includes(i)) return [];
  const hours = (special ?? store?.shift_hours?.[i])?.[shiftOfWeek(r, date)];
  return hours ? [hours] : [];
}

export const weekOf = (schedule: StaffSchedule, store: StoreHours | undefined, monday: Date): Shift[][] =>
  Array.from({ length: 7 }, (_, i) => shiftsOn(schedule, store, addDays(monday, i)));

/** Minutos entre dos fechas (ambas incluidas), día por día: tiene en cuenta la rotación. */
export function scheduleMinutes(schedule: StaffSchedule, store: StoreHours | undefined, from: Date, to: Date): number {
  let total = 0;
  for (let d = new Date(from.getFullYear(), from.getMonth(), from.getDate()); d <= to; d = addDays(d, 1)) total += dayMinutes(shiftsOn(schedule, store, d));
  return total;
}

/** "08:00" → "8", "08:30" → "8:30". */
const hourText = (t: string) => t.replace(/^0(\d)/, '$1').replace(/:00$/, '');
const sameShift = (a: Shift | null | undefined, b: Shift) => !!a && a.start === b.start && a.end === b.end;
const dayShort = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Texto de la semana para mandar al grupo de WhatsApp (con *negritas* de WhatsApp). */
export function scheduleWhatsappText(store: Pick<Store, 'name'> & StoreHours, schedules: StaffSchedule[], monday: Date): string {
  const lines = [`*Horarios RED MINI · ${store.name}*`, `Semana del lunes ${dayShort(monday)} al domingo ${dayShort(addDays(monday, 6))}`];
  for (let i = 0; i < 7; i++) {
    const date = addDays(monday, i);
    const groups = new Map<string, { shift: Shift; names: string[] }>();
    const off: string[] = [];
    for (const s of schedules) {
      const shifts = shiftsOn(s, store, date);
      if (shifts.length === 0) off.push(s.name);
      for (const sh of shifts) {
        const key = `${sh.start}-${sh.end}`;
        const g = groups.get(key) ?? { shift: sh, names: [] };
        g.names.push(s.name);
        groups.set(key, g);
      }
    }
    const special = storeDayOverride(store, date);
    const title = `*${WEEKDAYS[i]} ${dayShort(date)}${special?.label ? ` · ${special.label}` : ''}*`;
    if (special?.closed) {
      lines.push('', title, 'Cerrado');
      continue;
    }
    if (groups.size === 0) continue;
    lines.push('', title);
    const day = special ?? store.shift_hours?.[i];
    for (const { shift, names } of [...groups.values()].sort((a, b) => a.shift.start.localeCompare(b.shift.start))) {
      const span = `${hourText(shift.start)} a ${hourText(shift.end)}`;
      const label = sameShift(day?.morning, shift) ? `☀️ Mañana (${span})` : sameShift(day?.night, shift) ? `🌙 Noche (${span})` : `🕒 ${span}`;
      lines.push(`${label}: ${names.join(', ')}`);
    }
    if (off.length) lines.push(`Franco: ${off.join(', ')}`);
  }
  if (schedules.length) {
    lines.push('', '*Total de horas de la semana*');
    for (const s of schedules) lines.push(`${s.name}: ${formatHours(scheduleMinutes(s, store, monday, addDays(monday, 6)))}`);
  }
  return lines.join('\n');
}

export interface MonthPeriods {
  firstHalf: [Date, Date];
  secondHalf: [Date, Date];
  month: [Date, Date];
}

/** Quincenas (1 al 15 y 16 a fin de mes) y mes completo. `month` es "AAAA-MM". */
export function monthPeriods(month: string): MonthPeriods {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const lastDay = new Date(y, m, 0).getDate();
  const day = (n: number) => new Date(y, m - 1, n);
  return { firstHalf: [day(1), day(15)], secondHalf: [day(16), day(lastDay)], month: [day(1), day(lastDay)] };
}

/** "38 h" o "37 h 30 min". */
export function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export interface ScheduleInput {
  store_id: UUID;
  user_id: UUID | null;
  name: string;
  pay_period: PayPeriod;
  days: Shift[][];
  notes: string | null;
  rotation?: Rotation | null;
}

export async function listSchedules(storeId: UUID | null): Promise<StaffSchedule[]> {
  const rows = storeId ? await db.staff_schedules.where('store_id').equals(storeId).toArray() : await db.staff_schedules.toArray();
  return rows.filter((s) => !s.deleted_at).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export async function saveSchedule(input: ScheduleInput, existingId?: UUID): Promise<StaffSchedule> {
  const name = input.name.trim();
  if (!name) throw new ScheduleError('Ingresá el nombre');
  if (input.days.length !== 7) throw new ScheduleError('Faltan días en el horario');
  for (const [i, shifts] of input.days.entries()) {
    for (const s of shifts) {
      if (!TIME.test(s.start) || !TIME.test(s.end)) throw new ScheduleError(`Revisá los horarios del ${WEEKDAYS[i]!.toLowerCase()}`);
      if (s.start === s.end) throw new ScheduleError(`El turno del ${WEEKDAYS[i]!.toLowerCase()} empieza y termina a la misma hora`);
    }
  }
  const rotation = input.rotation ?? null;
  let days = input.days;
  if (rotation) {
    if (rotation.work_days.length === 0) throw new ScheduleError('Marcá los días que trabaja');
    const store = await db.stores.get(input.store_id);
    if (!store?.shift_hours) throw new ScheduleError(`Primero cargá los turnos de ${store?.name ?? 'la sucursal'} (botón Turnos de los locales)`);
    // `days` guarda la semana base, para quien abra los horarios con una versión anterior.
    days = weekOf({ days: emptyWeek(), rotation } as StaffSchedule, store, parseDayKey(rotation.week));
  }
  const deviceId = await getDeviceId();
  return db.transaction('rw', db.staff_schedules, db.sync_queue, async () => {
    const previous = existingId ? await db.staff_schedules.get(existingId) : undefined;
    const fields = {
      store_id: input.store_id,
      user_id: input.user_id,
      name,
      pay_period: input.pay_period,
      days: days.map((d) => [...d].sort((a, b) => a.start.localeCompare(b.start))),
      notes: input.notes?.trim() || null,
      rotation: rotation ? { ...rotation, work_days: [...new Set(rotation.work_days)].sort() } : null,
    };
    const schedule: StaffSchedule = previous ? { ...touchMeta(previous, deviceId), ...fields } : { id: uuidv7(), ...newMeta(deviceId), ...fields };
    await db.staff_schedules.put(schedule);
    await enqueue('staff_schedules', schedule.id, 'upsert', schedule);
    return schedule;
  });
}

export async function deleteSchedule(id: UUID): Promise<void> {
  const deviceId = await getDeviceId();
  await db.transaction('rw', db.staff_schedules, db.sync_queue, async () => {
    const s = await db.staff_schedules.get(id);
    if (!s) return;
    const removed = { ...touchMeta(s, deviceId), deleted_at: nowISO() };
    await db.staff_schedules.put(removed);
    await enqueue('staff_schedules', id, 'upsert', removed);
  });
}

export const emptyWeek = (): Shift[][] => Array.from({ length: 7 }, () => []);

/** Guarda el horario de los turnos mañana y noche de un local (7 días, de lunes a domingo). */
export async function saveStoreShifts(storeId: UUID, hours: StoreShiftDay[]): Promise<void> {
  if (hours.length !== 7) throw new ScheduleError('Faltan días');
  for (const [i, day] of hours.entries()) {
    for (const s of [day.morning, day.night]) {
      if (!s) continue;
      if (!TIME.test(s.start) || !TIME.test(s.end)) throw new ScheduleError(`Revisá los horarios del ${WEEKDAYS[i]!.toLowerCase()}`);
      if (s.start === s.end) throw new ScheduleError(`Un turno del ${WEEKDAYS[i]!.toLowerCase()} empieza y termina a la misma hora`);
    }
  }
  const deviceId = await getDeviceId();
  await db.transaction('rw', db.stores, db.sync_queue, async () => {
    const store = await db.stores.get(storeId);
    if (!store) throw new ScheduleError('La sucursal no existe');
    const row = { ...touchMeta(store, deviceId), shift_hours: hours.map((d) => ({ morning: d.morning, night: d.night })) };
    await db.stores.put(row);
    await enqueue('stores', row.id, 'upsert', row);
  });
}

/** Los cambios por fecha se guardan unos meses y después se descartan, para que no crezcan para siempre. */
const KEEP_DAYS = 120;
function prune<T>(map: Record<string, T> | null | undefined): Record<string, T> {
  const oldest = dayKeyOf(addDays(new Date(), -KEEP_DAYS));
  return Object.fromEntries(Object.entries(map ?? {}).filter(([day]) => day >= oldest));
}

function checkShifts(shifts: Shift[]) {
  for (const s of shifts) {
    if (!TIME.test(s.start) || !TIME.test(s.end)) throw new ScheduleError('Revisá los horarios');
    if (s.start === s.end) throw new ScheduleError('Un turno empieza y termina a la misma hora');
  }
}

/** Cambio puntual de una persona un día: `shifts` = lo que trabaja ([] = franco); null = vuelve a lo de siempre. */
export async function setScheduleOverride(id: UUID, day: string, shifts: Shift[] | null): Promise<void> {
  if (shifts) checkShifts(shifts);
  const deviceId = await getDeviceId();
  await db.transaction('rw', db.staff_schedules, db.sync_queue, async () => {
    const current = await db.staff_schedules.get(id);
    if (!current) throw new ScheduleError('El horario no existe');
    const overrides = prune(current.overrides);
    if (shifts) overrides[day] = [...shifts].sort((a, b) => a.start.localeCompare(b.start));
    else delete overrides[day];
    const row = { ...touchMeta(current, deviceId), overrides };
    await db.staff_schedules.put(row);
    await enqueue('staff_schedules', row.id, 'upsert', row);
  });
}

/** Día especial del local (feriado): otro horario de turnos o cerrado; null = horario normal. */
export async function setStoreOverride(storeId: UUID, day: string, override: StoreDayOverride | null): Promise<void> {
  if (override) checkShifts([override.morning, override.night].filter((s): s is Shift => s !== null));
  const deviceId = await getDeviceId();
  await db.transaction('rw', db.stores, db.sync_queue, async () => {
    const store = await db.stores.get(storeId);
    if (!store) throw new ScheduleError('La sucursal no existe');
    const overrides = prune(store.shift_overrides);
    if (override) overrides[day] = { morning: override.morning, night: override.night, closed: override.closed, label: override.label?.trim() || null };
    else delete overrides[day];
    const row = { ...touchMeta(store, deviceId), shift_overrides: overrides };
    await db.stores.put(row);
    await enqueue('stores', row.id, 'upsert', row);
  });
}
