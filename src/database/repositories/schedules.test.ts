import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { deleteSchedule, emptyWeek, formatHours, listSchedules, minutesBetween, monthPeriods, saveSchedule, ScheduleError, shiftMinutes, weekMinutes } from './schedules';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

/** Lunes a viernes 8 a 14 (6 h) y sábado 9 a 13 (4 h): 34 h por semana. */
const week = () => {
  const days = emptyWeek();
  for (let i = 0; i < 5; i++) days[i] = [{ start: '08:00', end: '14:00' }];
  days[5] = [{ start: '09:00', end: '13:00' }];
  return days;
};

describe('horarios', () => {
  it('suma turnos, incluso los que cruzan la medianoche', () => {
    expect(shiftMinutes({ start: '18:00', end: '02:00' })).toBe(480);
    expect(weekMinutes(week())).toBe(34 * 60);
    expect(formatHours(34 * 60)).toBe('34 h');
    expect(formatHours(37 * 60 + 30)).toBe('37 h 30 min');
  });

  it('cuenta las horas de cada quincena y del mes según el calendario', () => {
    // Noviembre 2026 empieza domingo: del 1 al 15 hay 10 días de semana y 2 sábados.
    const p = monthPeriods('2026-11');
    expect(minutesBetween(week(), ...p.firstHalf)).toBe((10 * 6 + 2 * 4) * 60);
    // Del 16 al 30: 11 días de semana y 2 sábados.
    expect(minutesBetween(week(), ...p.secondHalf)).toBe((11 * 6 + 2 * 4) * 60);
    expect(minutesBetween(week(), ...p.month)).toBe((21 * 6 + 4 * 4) * 60);
  });

  it('guarda, valida y borra', async () => {
    const s = await saveSchedule({ store_id: 's1', user_id: null, name: ' Ana ', pay_period: 'biweekly', days: week(), notes: null });
    expect((await listSchedules('s1')).map((x) => x.name)).toEqual(['Ana']);
    expect((await db.sync_queue.toArray()).map((q) => q.table)).toEqual(['staff_schedules']);
    const bad = emptyWeek();
    bad[2] = [{ start: '25:00', end: '10:00' }];
    await expect(saveSchedule({ store_id: 's1', user_id: null, name: 'Beto', pay_period: 'weekly', days: bad, notes: null })).rejects.toThrow(ScheduleError);
    await deleteSchedule(s.id);
    expect(await listSchedules(null)).toEqual([]);
  });
});
