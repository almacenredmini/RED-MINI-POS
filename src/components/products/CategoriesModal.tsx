import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useToast } from '@/contexts/ToastContext';
import { db } from '@/database/db';
import { ensureCategory, listCategories, setCategoryPerishable } from '@/database/repositories/categories';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import styles from './CategoriesModal.module.css';

/** Categorías y su tipo: las comestibles avisan cuando sus productos no se venden, para revisar vencimientos. */
export function CategoriesModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const categories = useLiveQuery(listCategories, [], []);
  const counts = useLiveQuery(async () => {
    const map = new Map<string, number>();
    await db.products.each((p) => {
      if (!p.deleted_at && p.category_id) map.set(p.category_id, (map.get(p.category_id) ?? 0) + 1);
    });
    return map;
  }, [], new Map<string, number>());
  const [name, setName] = useState('');

  const add = async () => {
    if (!name.trim()) return;
    await ensureCategory(name);
    setName('');
  };

  const toggle = (id: string, value: boolean) => setCategoryPerishable(id, value).catch(() => toast('No se pudo guardar', 'error'));

  return (
    <Modal open title="Categorías" onClose={onClose}>
      <div className={styles.wrap}>
        <p className="muted">Marcá como comestibles las categorías con vencimiento. Si sus productos no se venden, aparecen en Inicio para que revises las fechas.</p>
        <form
          className={styles.add}
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nueva categoría" aria-label="Nueva categoría" autoComplete="off" />
          <Button type="submit" icon="plus" disabled={!name.trim()}>
            Agregar
          </Button>
        </form>
        {categories.length === 0 ? (
          <p className="muted">Todavía no hay categorías.</p>
        ) : (
          <ul className={styles.list}>
            {categories.map((c) => (
              <li key={c.id}>
                <span className={styles.name}>
                  {c.name}
                  <span className="muted"> · {counts.get(c.id) ?? 0} {counts.get(c.id) === 1 ? 'producto' : 'productos'}</span>
                </span>
                <div className={styles.segmented} role="group" aria-label={`Tipo de ${c.name}`}>
                  <button type="button" aria-pressed={c.perishable === true} onClick={() => void toggle(c.id, true)}>
                    Comestible
                  </button>
                  <button type="button" aria-pressed={c.perishable !== true} onClick={() => void toggle(c.id, false)}>
                    No comestible
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
