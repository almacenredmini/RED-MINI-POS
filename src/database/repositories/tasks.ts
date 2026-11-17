import { db } from '../db';
import { getDeviceId } from '../meta';
import { enqueue, newMeta, touchMeta } from '../outbox';
import { nowISO, uuidv7 } from '@/services/id';
import type { DayTask, TaskAssignment, TaskTemplate, UUID } from '@/types/domain';

/**
 * Pendientes del día. Cada sucursal tiene su planilla (lo de todos los días) y se le pueden
 * sumar cosas sólo para un día. Los cajeros marcan lo que hicieron y queda quién y a qué hora.
 */

export class TaskError extends Error {}

/** `AAAA-MM-DD` en hora local. */
export const dayKey = (d: Date = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Lunes de la semana del día (`AAAA-MM-DD`): los cajeros rotan semana a semana. */
export const weekKey = (day: string) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dayKey(d);
};

/** Corre una semana (`AAAA-MM-DD` de un lunes) `n` semanas. */
export const shiftWeek = (week: string, n: number) => {
  const d = new Date(`${week}T12:00:00`);
  d.setDate(d.getDate() + 7 * n);
  return dayKey(d);
};

export interface Assignee {
  userId: UUID | null;
  name: string | null;
}

export interface TaskView {
  /** Para la lista: id de la planilla o del pendiente del día. */
  key: string;
  title: string;
  templateId: UUID | null;
  /** Fila del día, si ya existe (se marcó alguna vez o se agregó sólo para ese día). */
  rowId: UUID | null;
  /** Agregado sólo para ese día. */
  extra: boolean;
  /** A quién le toca esta semana (sólo los de la planilla). */
  assignedTo: UUID | null;
  assignedName: string | null;
  doneBy: UUID | null;
  doneByName: string | null;
  doneAt: string | null;
}

const alive = <T extends { deleted_at: string | null }>(r: T) => !r.deleted_at;
const byPosition = (a: TaskTemplate, b: TaskTemplate) => a.position - b.position || a.created_at.localeCompare(b.created_at);

export async function listTemplates(storeId: UUID): Promise<TaskTemplate[]> {
  return (await db.task_templates.where('store_id').equals(storeId).toArray()).filter(alive).sort(byPosition);
}

/** La planilla más lo agregado ese día. Lo marcado de algo que después se sacó de la planilla sigue apareciendo. */
export async function listDayTasks(storeId: UUID, day: string): Promise<TaskView[]> {
  const [templates, rows, who] = await Promise.all([
    listTemplates(storeId),
    db.day_tasks.where('[store_id+day]').equals([storeId, day]).toArray(),
    weekAssignments(storeId, weekKey(day)),
  ]);
  const live = rows.filter(alive);
  // Si dos cajas marcaron lo mismo sin conexión hay dos filas: vale la primera que se marcó.
  const rowOf = (templateId: UUID) =>
    live
      .filter((r) => r.template_id === templateId)
      .sort((a, b) => (a.done_at ?? '9').localeCompare(b.done_at ?? '9') || a.created_at.localeCompare(b.created_at))[0];
  const view = (r: DayTask | undefined, base: Pick<TaskView, 'key' | 'title' | 'templateId' | 'extra'>): TaskView => ({
    ...base,
    assignedTo: base.templateId ? (who.get(base.templateId)?.userId ?? null) : null,
    assignedName: base.templateId ? (who.get(base.templateId)?.name ?? null) : null,
    rowId: r?.id ?? null,
    doneBy: r?.done_at ? r.done_by : null,
    doneByName: r?.done_at ? r.done_by_name : null,
    doneAt: r?.done_at ?? null,
  });

  const fromTemplate = templates.map((t) => view(rowOf(t.id), { key: t.id, title: t.title, templateId: t.id, extra: false }));
  const ids = new Set(templates.map((t) => t.id));
  const removedButDone = live.filter((r) => r.template_id && !ids.has(r.template_id) && r.done_at).map((r) => view(r, { key: r.id, title: r.title, templateId: r.template_id, extra: false }));
  const extras = live
    .filter((r) => !r.template_id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((r) => view(r, { key: r.id, title: r.title, templateId: null, extra: true }));
  return [...fromTemplate, ...removedButDone, ...extras];
}

async function putRow(row: DayTask) {
  await db.day_tasks.put(row);
  await enqueue('day_tasks', row.id, 'upsert', row);
}

/** Marca o desmarca un pendiente. Al marcar queda quién y a qué hora. */
export async function setTaskDone(input: { storeId: UUID; day: string; task: TaskView; done: boolean; user: { id: UUID; name: string } | null }): Promise<void> {
  const deviceId = await getDeviceId();
  const now = nowISO();
  const mark = input.done
    ? { done_by: input.user?.id ?? null, done_by_name: input.user?.name ?? null, done_at: now }
    : { done_by: null, done_by_name: null, done_at: null };
  await db.transaction('rw', db.day_tasks, db.sync_queue, async () => {
    const current = input.task.rowId ? await db.day_tasks.get(input.task.rowId) : undefined;
    if (current) return putRow({ ...touchMeta(current, deviceId), ...mark });
    if (!input.done) return;
    await putRow({
      id: uuidv7(),
      ...newMeta(deviceId),
      store_id: input.storeId,
      day: input.day,
      template_id: input.task.templateId,
      title: input.task.title,
      created_by: null,
      ...mark,
    });
  });
}

const cleanTitle = (title: string) => {
  const t = title.trim().replace(/\s+/g, ' ');
  if (!t) throw new TaskError('Escribí el pendiente');
  return t;
};

/** Algo sólo para ese día: no queda en la planilla. */
export async function addDayTask(storeId: UUID, day: string, title: string, userId: UUID | null): Promise<void> {
  const deviceId = await getDeviceId();
  const row: DayTask = { id: uuidv7(), ...newMeta(deviceId), store_id: storeId, day, template_id: null, title: cleanTitle(title), created_by: userId, done_by: null, done_by_name: null, done_at: null };
  await db.transaction('rw', db.day_tasks, db.sync_queue, () => putRow(row));
}

export async function removeDayTask(id: UUID): Promise<void> {
  const deviceId = await getDeviceId();
  await db.transaction('rw', db.day_tasks, db.sync_queue, async () => {
    const row = await db.day_tasks.get(id);
    if (row) await putRow({ ...touchMeta(row, deviceId), deleted_at: nowISO() });
  });
}

async function putTemplate(t: TaskTemplate) {
  await db.task_templates.put(t);
  await enqueue('task_templates', t.id, 'upsert', t);
}

/** Agrega a la planilla: aparece todos los días, desde hoy. */
export async function addTemplate(storeId: UUID, title: string): Promise<void> {
  const deviceId = await getDeviceId();
  await db.transaction('rw', db.task_templates, db.sync_queue, async () => {
    const last = (await listTemplates(storeId)).at(-1);
    await putTemplate({ id: uuidv7(), ...newMeta(deviceId), store_id: storeId, title: cleanTitle(title), position: (last?.position ?? 0) + 1 });
  });
}

export async function renameTemplate(id: UUID, title: string): Promise<void> {
  const clean = cleanTitle(title);
  const deviceId = await getDeviceId();
  await db.transaction('rw', db.task_templates, db.sync_queue, async () => {
    const t = await db.task_templates.get(id);
    if (t && t.title !== clean) await putTemplate({ ...touchMeta(t, deviceId), title: clean });
  });
}

/** Lo saca de la planilla. Lo que ya se marcó en días anteriores queda en el historial. */
export async function removeTemplate(id: UUID): Promise<void> {
  const deviceId = await getDeviceId();
  await db.transaction('rw', db.task_templates, db.sync_queue, async () => {
    const t = await db.task_templates.get(id);
    if (t) await putTemplate({ ...touchMeta(t, deviceId), deleted_at: nowISO() });
  });
}

/** Sube o baja un lugar en la planilla. */
export async function moveTemplate(storeId: UUID, id: UUID, delta: -1 | 1): Promise<void> {
  const deviceId = await getDeviceId();
  await db.transaction('rw', db.task_templates, db.sync_queue, async () => {
    const list = await listTemplates(storeId);
    const i = list.findIndex((t) => t.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    // Renumera todo: así no quedan posiciones repetidas.
    for (const [k, t] of list.entries()) if (t.position !== k + 1) await putTemplate({ ...touchMeta(t, deviceId), position: k + 1 });
  });
}

/** Todas las asignaciones de la sucursal: son pocas (pendientes × semanas). */
async function allAssignments(storeId: UUID): Promise<TaskAssignment[]> {
  return (await db.task_assignments.where('store_id').equals(storeId).toArray()).filter(alive);
}

/**
 * Rotativo: lo que una semana hacía cada persona pasa a la siguiente, en el orden en que aparecen
 * en la planilla (el primero toma lo del segundo... y el último, lo del primero). Cada uno se lleva
 * su grupo de pendientes entero.
 */
function rotate(templates: TaskTemplate[], before: Map<UUID, Assignee>): Map<UUID, Assignee> {
  const people: Assignee[] = [];
  for (const t of templates) {
    const a = before.get(t.id);
    if (a?.userId && !people.some((p) => p.userId === a.userId)) people.push(a);
  }
  const next = new Map<UUID, Assignee>();
  for (const t of templates) {
    const a = before.get(t.id);
    const i = people.findIndex((p) => p.userId === a?.userId);
    next.set(t.id, i < 0 ? { userId: null, name: null } : people[(i + 1) % people.length]!);
  }
  return next;
}

/**
 * A quién le toca cada pendiente de la planilla en una semana. Desde la primera semana que se asignó,
 * cada lunes rota sola; lo que se cambió a mano en una semana pisa la rotación y sigue rotando desde ahí.
 */
export async function weekAssignments(storeId: UUID, week: string): Promise<Map<UUID, Assignee>> {
  const [templates, rows] = await Promise.all([listTemplates(storeId), allAssignments(storeId)]);
  const past = rows.filter((r) => r.week <= week).sort((a, b) => a.week.localeCompare(b.week) || a.updated_at.localeCompare(b.updated_at));
  let current = new Map<UUID, Assignee>();
  if (past.length === 0) return current;
  // Semana por semana desde la primera asignación (son pocas: una por semana).
  for (let w = past[0]!.week, guard = 0; w <= week && guard < 2000; w = shiftWeek(w, 1), guard++) {
    if (current.size > 0) current = rotate(templates, current);
    for (const r of past) if (r.week === w) current.set(r.template_id, { userId: r.user_id, name: r.user_name });
  }
  return current;
}

async function putAssignment(storeId: UUID, week: string, templateId: UUID, who: Assignee, deviceId: UUID) {
  const current = (await allAssignments(storeId)).filter((r) => r.week === week && r.template_id === templateId).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  if (current && current.user_id === who.userId) return;
  const row: TaskAssignment = current
    ? { ...touchMeta(current, deviceId), user_id: who.userId, user_name: who.name }
    : { id: uuidv7(), ...newMeta(deviceId), store_id: storeId, week, template_id: templateId, user_id: who.userId, user_name: who.name };
  await db.task_assignments.put(row);
  await enqueue('task_assignments', row.id, 'upsert', row);
}

/** Asigna un pendiente de la planilla a alguien esa semana; las siguientes rotan desde ahí. */
export async function assignTask(storeId: UUID, week: string, templateId: UUID, who: Assignee): Promise<void> {
  const deviceId = await getDeviceId();
  await db.transaction('rw', db.task_assignments, db.sync_queue, () => putAssignment(storeId, week, templateId, who, deviceId));
}
