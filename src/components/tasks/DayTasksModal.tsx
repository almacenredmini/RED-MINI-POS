import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrentStore } from '@/contexts/DeviceContext';
import { useToast } from '@/contexts/ToastContext';
import { addDayTask, addTemplate, dayKey, listDayTasks, listTemplates, moveTemplate, removeDayTask, removeTemplate, renameTemplate, setTaskDone, type TaskView } from '@/database/repositories/tasks';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import styles from './Tasks.module.css';

const hour = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

/** Cuántos pendientes quedan hoy en la sucursal: para el botón de la pantalla de venta. */
export function usePendingCount(storeId: string): number {
  return useLiveQuery(async () => (await listDayTasks(storeId, dayKey())).filter((t) => !t.doneAt).length, [storeId], 0);
}

/** Botón del encabezado: se ve en todas las pantallas, con cuántos pendientes quedan. */
export function DayTasksButton() {
  const store = useCurrentStore();
  const pending = usePendingCount(store.id);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" icon="check" className={styles.headerButton} onClick={() => setOpen(true)}>
        Pendientes del día
        {pending > 0 && <span className={styles.badge}>{pending}</span>}
      </Button>
      {open && (
        <DayTasksModal
          onClose={() => {
            setOpen(false);
            // En Vender, el recuadro del código vuelve a quedar listo para escanear.
            window.dispatchEvent(new Event('focus'));
          }}
        />
      )}
    </>
  );
}

/**
 * Pendientes del día: todos los ven y marcan lo que hicieron (queda quién y a qué hora).
 * Quien tiene `tasks.manage` agrega cosas para ese día, edita la planilla y mira otros días.
 */
export function DayTasksModal({ onClose }: { onClose: () => void }) {
  const store = useCurrentStore();
  const { user, can } = useAuth();
  const toast = useToast();
  const manager = can('tasks.manage');
  const [day, setDay] = useState(() => dayKey());
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const tasks = useLiveQuery(() => listDayTasks(store.id, day), [store.id, day]);
  const isToday = day === dayKey();

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error');
    }
  };

  const toggle = (t: TaskView) => {
    if (!t.doneAt) return void run(() => setTaskDone({ storeId: store.id, day, task: t, done: true, user: user ? { id: user.id, name: user.name } : null }));
    // Desmarcar: quien lo marcó o un encargado.
    if (!manager && t.doneBy !== user?.id) return toast(`Lo marcó ${t.doneByName ?? 'otra persona'}: sólo un encargado lo puede desmarcar`, 'error');
    void run(() => setTaskDone({ storeId: store.id, day, task: t, done: false, user: null }));
  };

  // El campo se vacía en el acto: si se escribe lo siguiente enseguida, no se mezcla con lo anterior.
  const addToday = () => {
    const value = text;
    setText('');
    void run(() => addDayTask(store.id, day, value, user?.id ?? null).catch((e: unknown) => (setText(value), Promise.reject(e))));
  };

  const done = tasks?.filter((t) => t.doneAt).length ?? 0;

  // Una sola ventana: cambiar de <dialog> al editar la planilla la cerraba.
  if (editing) {
    return (
      <Modal
        open
        title={`Planilla de ${store.name}`}
        onClose={onClose}
        footer={
          <Button icon="back" onClick={() => setEditing(false)}>
            Volver a los pendientes
          </Button>
        }
      >
        <TemplateEditor storeId={store.id} />
      </Modal>
    );
  }

  return (
    <Modal
      open
      title={isToday ? 'Pendientes del día' : `Pendientes del ${new Date(`${day}T12:00:00`).toLocaleDateString('es-AR')}`}
      onClose={onClose}
      footer={
        manager && (
          <div className={styles.footer}>
            <Input type="date" value={day} max={dayKey()} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Día" />
            <Button icon="settings" onClick={() => setEditing(true)}>
              Editar planilla
            </Button>
          </div>
        )
      }
    >
      {!tasks ? null : tasks.length === 0 ? (
        <EmptyState icon="check" title="No hay pendientes">
          {manager && <p>Armá la planilla con lo de todos los días en "Editar planilla", o agregá algo sólo para hoy abajo.</p>}
        </EmptyState>
      ) : (
        <>
          <p className="muted">
            {done} de {tasks.length} hechos
          </p>
          <ul className={styles.list}>
            {tasks.map((t) => (
              <li key={t.key} className={t.doneAt ? styles.done : undefined}>
                <button type="button" className={styles.task} onClick={() => toggle(t)} aria-pressed={!!t.doneAt}>
                  <span className={styles.box}>{t.doneAt && <Icon name="check" size={16} />}</span>
                  <span className={styles.text}>
                    <span className={styles.title}>{t.title}</span>
                    {t.doneAt ? (
                      <span className={styles.who}>
                        {t.doneByName ?? 'Sin usuario'} · {hour(t.doneAt)}
                      </span>
                    ) : (
                      t.extra && <span className="muted">Sólo para este día</span>
                    )}
                  </span>
                </button>
                {manager && t.extra && t.rowId && (
                  <Button size="sm" variant="ghost" icon="trash" aria-label={`Quitar ${t.title}`} onClick={() => void run(() => removeDayTask(t.rowId!))} />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {manager && (
        <form
          className={styles.add}
          onSubmit={(e) => {
            e.preventDefault();
            addToday();
          }}
        >
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={isToday ? 'Agregar algo sólo para hoy' : 'Agregar algo sólo para este día'} maxLength={120} autoComplete="off" />
          <Button type="submit" icon="plus" disabled={!text.trim()}>
            Agregar
          </Button>
        </form>
      )}
    </Modal>
  );
}

/** La planilla: lo que aparece todos los días. Cambiarla no toca lo ya marcado. */
function TemplateEditor({ storeId }: { storeId: string }) {
  const toast = useToast();
  const templates = useLiveQuery(() => listTemplates(storeId), [storeId]);
  const [text, setText] = useState('');

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error');
    }
  };

  return (
    <>
      <p className="muted">Esto aparece todos los días. Para algo de un solo día, agregalo desde los pendientes.</p>
      <ul className={styles.list}>
        {templates?.map((t, i) => (
          <li key={t.id}>
            <Input
              key={`${t.id}:${t.title}`}
              className={styles.edit}
              defaultValue={t.title}
              maxLength={120}
              aria-label="Pendiente"
              onBlur={(e) => e.target.value.trim() !== t.title && void run(() => renameTemplate(t.id, e.target.value))}
            />
            <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => void run(() => moveTemplate(storeId, t.id, -1))} aria-label="Subir">
              ↑
            </Button>
            <Button size="sm" variant="ghost" disabled={i === templates.length - 1} onClick={() => void run(() => moveTemplate(storeId, t.id, 1))} aria-label="Bajar">
              ↓
            </Button>
            <Button size="sm" variant="ghost" icon="trash" aria-label={`Quitar ${t.title}`} onClick={() => void run(() => removeTemplate(t.id))} />
          </li>
        ))}
      </ul>
      <form
        className={styles.add}
        onSubmit={(e) => {
          e.preventDefault();
          const value = text;
          setText('');
          void run(() => addTemplate(storeId, value).catch((err: unknown) => (setText(value), Promise.reject(err))));
        }}
      >
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ej.: Limpiar heladeras" maxLength={120} autoComplete="off" autoFocus />
        <Button type="submit" icon="plus" disabled={!text.trim()}>
          Agregar
        </Button>
      </form>
    </>
  );
}
