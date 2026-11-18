import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useToast } from "@/contexts/ToastContext";
import { db } from "@/database/db";
import {
  CategoryError,
  ensureCategory,
  listCategories,
  renameCategory,
  setCategoryPerishable,
} from "@/database/repositories/categories";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import styles from "./CategoriesModal.module.css";

/** Categorías y su tipo: las comestibles avisan cuando sus productos no se venden, para revisar vencimientos. */
export function CategoriesModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const categories = useLiveQuery(listCategories, [], []);
  const counts = useLiveQuery(
    async () => {
      const map = new Map<string, number>();
      await db.products.each((p) => {
        if (!p.deleted_at && p.category_id)
          map.set(p.category_id, (map.get(p.category_id) ?? 0) + 1);
      });
      return map;
    },
    [],
    new Map<string, number>(),
  );
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  );

  const saveName = async () => {
    if (!renaming) return;
    try {
      await renameCategory(renaming.id, renaming.name);
      setRenaming(null);
      toast("Nombre cambiado", "success");
    } catch (e) {
      toast(
        e instanceof CategoryError ? e.message : "No se pudo guardar",
        "error",
      );
    }
  };

  const add = async () => {
    if (!name.trim()) return;
    await ensureCategory(name);
    setName("");
  };

  const toggle = (id: string, value: boolean) =>
    setCategoryPerishable(id, value).catch(() =>
      toast("No se pudo guardar", "error"),
    );

  return (
    <Modal open title="Categorías" onClose={onClose}>
      <div className={styles.wrap}>
        <p className="muted">
          Tocá Renombrar para cambiarle el nombre a una categoría: sus productos
          la siguen teniendo. Marcá como comestibles las categorías con
          vencimiento. Si sus productos no se venden, aparecen en Inicio para
          que revises las fechas.
        </p>
        <form
          className={styles.add}
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nueva categoría"
            aria-label="Nueva categoría"
            autoComplete="off"
          />
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
                {renaming?.id === c.id ? (
                  <form
                    className={styles.rename}
                    onSubmit={(e) => {
                      e.preventDefault();
                      void saveName();
                    }}
                  >
                    <Input
                      value={renaming.name}
                      onChange={(e) =>
                        setRenaming({ id: c.id, name: e.target.value })
                      }
                      onKeyDown={(e) =>
                        e.key === "Escape" &&
                        (e.stopPropagation(), setRenaming(null))
                      }
                      aria-label={`Nuevo nombre de ${c.name}`}
                      autoFocus
                      autoComplete="off"
                    />
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      icon="check"
                      disabled={!renaming.name.trim()}
                    >
                      Guardar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setRenaming(null)}
                    >
                      Cancelar
                    </Button>
                  </form>
                ) : (
                  <span className={styles.name}>
                    {c.name}
                    <span className="muted">
                      {" "}
                      · {counts.get(c.id) ?? 0}{" "}
                      {counts.get(c.id) === 1 ? "producto" : "productos"}
                    </span>
                  </span>
                )}
                <div className={styles.rowActions}>
                  {renaming?.id !== c.id && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setRenaming({ id: c.id, name: c.name })}
                    >
                      Renombrar
                    </Button>
                  )}
                  <div
                    className={styles.segmented}
                    role="group"
                    aria-label={`Tipo de ${c.name}`}
                  >
                    <button
                      type="button"
                      aria-pressed={c.perishable === true}
                      onClick={() => void toggle(c.id, true)}
                    >
                      Comestible
                    </button>
                    <button
                      type="button"
                      aria-pressed={c.perishable !== true}
                      onClick={() => void toggle(c.id, false)}
                    >
                      No comestible
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
