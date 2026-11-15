import { db } from '../db';
import { getDeviceId } from '../meta';
import { enqueue, newMeta, touchMeta } from '../outbox';
import { nowISO, uuidv7 } from '@/services/id';
import type { PayPeriod, Shift, StaffSchedule, UUID } from '@/types/domain';

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
  const deviceId = await getDeviceId();
  return db.transaction('rw', db.staff_schedules, db.sync_queue, async () => {
    const previous = existingId ? await db.staff_schedules.get(existingId) : undefined;
    const fields = {
      store_id: input.store_id,
      user_id: input.user_id,
      name,
      pay_period: input.pay_period,
      days: input.days.map((d) => [...d].sort((a, b) => a.start.localeCompare(b.start))),
      notes: input.notes?.trim() || null,
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
