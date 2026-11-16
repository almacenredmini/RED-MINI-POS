import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { addDayTask, addTemplate, listDayTasks, listTemplates, moveTemplate, removeTemplate, setTaskDone } from './tasks';

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
});
