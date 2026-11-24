import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { addDays, dayKeyOf, deleteSchedule, emptyWeek, formatHours, listSchedules, minutesBetween, mondayOf, monthPeriods, saveSchedule, saveStoreShifts, ScheduleError, setScheduleOverride, setStoreOverride, shiftsOn, scheduleMinutes, scheduleWhatsappText, scheduleWhatsappTextByPerson, shiftMinutes, shiftOfWeek, weekMinutes, weekOf } from './schedules';

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

describe('turnos de los locales y rotación', () => {
  const day = { morning: { start: '08:00', end: '15:00' }, night: { start: '15:00', end: '22:00' } };
  // Domingo sólo a la mañana, 9 a 13.
  const hours = [day, day, day, day, day, day, { morning: { start: '09:00', end: '13:00' }, night: null }];
  const monday = new Date(2026, 10, 23);
  const nextMonday = new Date(2026, 10, 30);

  async function setup() {
    await db.stores.put({ id: 's1', code: 'ORO', name: 'Oroño', address: null, active: true, created_at: '', updated_at: '', deleted_at: null, version: 1, updated_by_device: 'd' });
    const rot = (shift: 'morning' | 'night', work_days: number[]) => ({ work_days, shift, week: '2026-11-23', rotates: true });
    await expect(saveSchedule({ store_id: 's1', user_id: null, name: 'Cami', pay_period: 'weekly', days: emptyWeek(), notes: null, rotation: rot('morning', [0, 1, 2, 3, 4, 5]) })).rejects.toThrow('Primero cargá los turnos de Oroño');
    await saveStoreShifts('s1', hours);
    const cami = await saveSchedule({ store_id: 's1', user_id: null, name: 'Cami', pay_period: 'weekly', days: emptyWeek(), notes: null, rotation: rot('morning', [0, 1, 2, 3, 4, 5]) });
    const juan = await saveSchedule({ store_id: 's1', user_id: null, name: 'Juan', pay_period: 'weekly', days: emptyWeek(), notes: null, rotation: rot('night', [0, 1, 2, 3, 4, 6]) });
    return { store: (await db.stores.get('s1'))!, cami, juan };
  }

  it('cada semana cambia mañana por noche, con los horarios del local', async () => {
    const { store, cami, juan } = await setup();
    expect(shiftOfWeek(cami.rotation!, monday)).toBe('morning');
    expect(shiftOfWeek(cami.rotation!, nextMonday)).toBe('night');
    expect(shiftOfWeek(cami.rotation!, new Date(2026, 10, 16))).toBe('night');
    expect(weekOf(cami, store, monday)[0]).toEqual([{ start: '08:00', end: '15:00' }]);
    expect(weekOf(cami, store, nextMonday)[0]).toEqual([{ start: '15:00', end: '22:00' }]);
    expect(weekOf(cami, store, monday)[6]).toEqual([]);
    // Juan trabaja el domingo, pero esa semana le toca la noche y el domingo no hay noche.
    expect(weekOf(juan, store, monday)[6]).toEqual([]);
    expect(weekOf(juan, store, nextMonday)[6]).toEqual([{ start: '09:00', end: '13:00' }]);
    expect(scheduleMinutes(cami, store, monday, addDays(monday, 6))).toBe(6 * 7 * 60);
    expect(mondayOf(new Date(2026, 10, 29))).toEqual(monday);
    expect(dayKeyOf(mondayOf(new Date(2026, 10, 23)))).toBe('2026-11-23');
  });

  it('arma el mensaje para el grupo de WhatsApp', async () => {
    const { store, cami, juan } = await setup();
    const text = scheduleWhatsappText(store, [cami, juan], monday);
    expect(text).toContain('*Horarios RED MINI · Oroño*');
    expect(text).toContain('Semana del lunes 23/11 al domingo 29/11');
    expect(text).toContain('*Lunes 23/11*\n☀️ Mañana (8 a 15): Cami\n🌙 Noche (15 a 22): Juan');
    expect(text).toContain('*Sábado 28/11*\n☀️ Mañana (8 a 15): Cami\nFranco: Juan');
    // El domingo no trabaja nadie (Cami tiene franco y a Juan le toca noche): no aparece.
    expect(text).not.toContain('Domingo');
    // Juan: lunes a viernes de noche (7 h cada uno); el sábado tiene franco y el domingo no hay noche.
    expect(text).toContain('*Total de horas de la semana*\nCami: 42 h\nJuan: 35 h');
  });
});

describe('feriados y cambios de un día', () => {
  it('el feriado del local cambia el horario o cierra, y el cambio de una persona gana', async () => {
    const day = { morning: { start: '08:00', end: '15:00' }, night: { start: '15:00', end: '22:00' } };
    await db.stores.put({ id: 's1', code: 'ORO', name: 'Oroño', address: null, active: true, created_at: '', updated_at: '', deleted_at: null, version: 1, updated_by_device: 'd' });
    await saveStoreShifts('s1', Array.from({ length: 7 }, () => day));
    const rot = (shift: 'morning' | 'night') => ({ work_days: [0, 1, 2, 3, 4, 5], shift, week: '2026-11-23', rotates: true });
    const cami = await saveSchedule({ store_id: 's1', user_id: null, name: 'Cami', pay_period: 'weekly', days: emptyWeek(), notes: null, rotation: rot('morning') });
    const juan = await saveSchedule({ store_id: 's1', user_id: null, name: 'Juan', pay_period: 'weekly', days: emptyWeek(), notes: null, rotation: rot('night') });
    const monday = new Date(2026, 10, 23);
    const tuesday = new Date(2026, 10, 24);

    // Lunes feriado: mañana 9 a 13 y sin noche. Martes cerrado.
    await setStoreOverride('s1', '2026-11-23', { morning: { start: '09:00', end: '13:00' }, night: null, closed: false, label: 'Feriado' });
    await setStoreOverride('s1', '2026-11-24', { morning: null, night: null, closed: true, label: 'Feriado' });
    // Cami el miércoles tiene franco; Juan el jueves entra más tarde.
    await setScheduleOverride(cami.id, '2026-11-25', []);
    await setScheduleOverride(juan.id, '2026-11-26', [{ start: '17:00', end: '22:00' }]);

    const store = (await db.stores.get('s1'))!;
    const [c, j] = [(await db.staff_schedules.get(cami.id))!, (await db.staff_schedules.get(juan.id))!];
    expect(shiftsOn(c, store, monday)).toEqual([{ start: '09:00', end: '13:00' }]);
    expect(shiftsOn(j, store, monday)).toEqual([]);
    expect(shiftsOn(c, store, tuesday)).toEqual([]);
    expect(weekOf(c, store, monday)[2]).toEqual([]);
    expect(weekOf(j, store, monday)[3]).toEqual([{ start: '17:00', end: '22:00' }]);
    // Cami: 4 h (lunes) + 0 + 0 + 7 + 7 + 7 = 25 h.
    expect(scheduleMinutes(c, store, monday, addDays(monday, 6))).toBe(25 * 60);

    const text = scheduleWhatsappText(store, [c, j], monday);
    expect(text).toContain('*Lunes 23/11 · Feriado*\n☀️ Mañana (9 a 13): Cami\nFranco: Juan');
    expect(text).toContain('*Martes 24/11 · Feriado*\nCerrado');
    expect(text).toContain('*Jueves 26/11*\n☀️ Mañana (8 a 15): Cami\n🕒 17 a 22: Juan');

    const perPerson = scheduleWhatsappTextByPerson(store, [c, j], monday);
    expect(perPerson).toContain('*Cami* · ☀️ Mañana · 25 h\nLunes 23/11 (Feriado): 9 a 13\nMartes 24/11 (Feriado): Cerrado\nMiércoles 25/11: Franco\nJueves 26/11: 8 a 15');
    expect(perPerson).toContain('*Juan* · 🌙 Noche');
    expect(perPerson).toContain('Jueves 26/11: 17 a 22');

    // Volver a lo de siempre.
    await setScheduleOverride(cami.id, '2026-11-25', null);
    await setStoreOverride('s1', '2026-11-24', null);
    const store2 = (await db.stores.get('s1'))!;
    expect(shiftsOn((await db.staff_schedules.get(cami.id))!, store2, new Date(2026, 10, 25))).toEqual([{ start: '08:00', end: '15:00' }]);
    expect(shiftsOn((await db.staff_schedules.get(cami.id))!, store2, tuesday)).toEqual([{ start: '08:00', end: '15:00' }]);
  });
});
