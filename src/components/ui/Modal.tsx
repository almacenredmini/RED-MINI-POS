import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './Button';
import styles from './Modal.module.css';

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/** Usa <dialog> nativo: foco atrapado, Esc y capa superior sin librerías. */
export function Modal({ open, title, onClose, children, footer }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // autoFocus de React corre antes de abrir el <dialog>, cuando todavía no se puede enfocar.
      d.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      {open && (
        <div className={styles.panel}>
          <header className={styles.header}>
            <h2>{title}</h2>
            <Button variant="ghost" size="sm" icon="close" onClick={onClose} aria-label="Cerrar" />
          </header>
          <div className={styles.body}>{children}</div>
          {footer && <footer className={styles.footer}>{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
