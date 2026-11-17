import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { addDayTask, addTemplate, assignTask, listDayTasks, listTemplates, moveTemplate, removeTemplate, setTaskDone, weekKey } from './tasks';

const store = 'store-1';
const ana = { id: 'u1', name: 'Ana' };

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('pendientes del día', () => {
  it('la planilla aparece todos los días y lo marcado queda por día, con quién', async () => {
    await addTemplate(store, 'Limpiar heladeras');
    await addTemplate(store, '  Reponer   gaseosas ');
    const lunes = await listDayTasks(store, '2026-11-16');
    expect(lunes.map((t) => t.title)).toEqual(['Limpiar heladeras', 'Reponer gaseosas']);

    await setTaskDone({ storeId: store, day: '2026-11-16', task: lunes[0]!, done: true, user: ana });
    const after = await listDayTasks(store, '2026-11-16');
    expect(after[0]).toMatchObject({ doneByName: 'Ana', doneBy: 'u1' });
    expect(after[0]!.doneAt).not.toBeNull();

    const martes = await listDayTasks(store, '2026-11-17');
    expect(martes.every((t) => !t.doneAt)).toBe(true);
  });

  it('se puede desmarcar', async () => {
    await addTemplate(store, 'Barrer');
    const [t] = await listDayTasks(store, '2026-11-16');
    await setTaskDone({ storeId: store, day: '2026-11-16', task: t!, done: true, user: ana });
    const [marked] = await listDayTasks(store, '2026-11-16');
    await setTaskDone({ storeId: store, day: '2026-11-16', task: marked!, done: false, user: null });
    expect((await listDayTasks(store, '2026-11-16'))[0]!.doneAt).toBeNull();
  });

  it('lo agregado sólo para un día no queda en la planilla', async () => {
    await addTemplate(store, 'Barrer');
    await addDayTask(store, '2026-11-16', 'Recibir a Coca', 'u0');
    expect((await listDayTasks(store, '2026-11-16')).map((t) => [t.title, t.extra])).toEqual([
      ['Barrer', false],
      ['Recibir a Coca', true],
    ]);
    expect((await listDayTasks(store, '2026-11-17')).map((t) => t.title)).toEqual(['Barrer']);
  });

  it('sacar algo de la planilla conserva lo ya hecho en el historial', async () => {
    await addTemplate(store, 'Vidrieras');
    const [t] = await listDayTasks(store, '2026-11-16');
    await setTaskDone({ storeId: store, day: '2026-11-16', task: t!, done: true, user: ana });
    await removeTemplate(t!.templateId!);
    expect((await listDayTasks(store, '2026-11-16')).map((x) => x.title)).toEqual(['Vidrieras']);
    expect(await listDayTasks(store, '2026-11-17')).toEqual([]);
  });

  it('cada sucursal tiene su planilla y se puede reordenar', async () => {
    await addTemplate(store, 'A');
    await addTemplate(store, 'B');
    await addTemplate('store-2', 'Otra');
    const [a] = await listTemplates(store);
    await moveTemplate(store, a!.id, 1);
    expect((await listTemplates(store)).map((t) => t.title)).toEqual(['B', 'A']);
  });

  it('la semana empieza el lunes', () => {
    expect(weekKey('2026-11-16')).toBe('2026-11-16'); // lunes
    expect(weekKey('2026-11-22')).toBe('2026-11-16'); // domingo
    expect(weekKey('2026-11-23')).toBe('2026-11-23');
  });

  it('cada semana rota sola: cada uno pasa a lo del siguiente', async () => {
    for (const t of ['Heladeras', 'Vidrieras', 'Barrer', 'Reponer']) await addTemplate(store, t);
    const [h, v, b, r] = await listTemplates(store);
    const juan = { userId: 'u1', name: 'Juan' };
    const pedro = { userId: 'u2', name: 'Pedro' };
    const sofi = { userId: 'u3', name: 'Sofi' };
    // Semana del 16: Juan hace dos, Pedro una, Sofi una.
    await assignTask(store, '2026-11-16', h!.id, juan);
    await assignTask(store, '2026-11-16', v!.id, juan);
    await assignTask(store, '2026-11-16', b!.id, pedro);
    await assignTask(store, '2026-11-16', r!.id, sofi);
    const names = async (day: string) => (await listDayTasks(store, day)).map((t) => t.assignedName);

    expect(await names('2026-11-20')).toEqual(['Juan', 'Juan', 'Pedro', 'Sofi']);
    expect(await names('2026-11-23')).toEqual(['Pedro', 'Pedro', 'Sofi', 'Juan']);
    expect(await names('2026-11-30')).toEqual(['Sofi', 'Sofi', 'Juan', 'Pedro']);
    expect(await names('2026-12-07')).toEqual(['Juan', 'Juan', 'Pedro', 'Sofi']);
    // Antes de la primera asignación no hay nadie.
    expect(await names('2026-11-09')).toEqual([null, null, null, null]);
  });

  it('un cambio a mano pisa la rotación de esa semana y sigue rotando desde ahí', async () => {
    await addTemplate(store, 'A');
    await addTemplate(store, 'B');
    const [a, b] = await listTemplates(store);
    await assignTask(store, '2026-11-16', a!.id, { userId: 'u1', name: 'Juan' });
    await assignTask(store, '2026-11-16', b!.id, { userId: 'u2', name: 'Pedro' });
    // La semana del 23 Juan falta: B también la hace Pedro.
    await assignTask(store, '2026-11-23', b!.id, { userId: 'u2', name: 'Pedro' });
    const names = async (day: string) => (await listDayTasks(store, day)).map((t) => t.assignedName);
    expect(await names('2026-11-23')).toEqual(['Pedro', 'Pedro']);
    // Con una sola persona no hay a quién rotar: sigue Pedro.
    expect(await names('2026-11-30')).toEqual(['Pedro', 'Pedro']);
    // Se vuelve a repartir y desde ahí rota otra vez.
    await assignTask(store, '2026-12-07', a!.id, { userId: 'u1', name: 'Juan' });
    expect(await names('2026-12-07')).toEqual(['Juan', 'Pedro']);
    expect(await names('2026-12-14')).toEqual(['Pedro', 'Juan']);
  });
});
