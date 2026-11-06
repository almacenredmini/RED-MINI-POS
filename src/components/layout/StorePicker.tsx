import { useDevice } from '@/contexts/DeviceContext';
import { Icon } from '@/components/ui/Icon';
import { Logo } from '@/components/ui/Logo';
import styles from './StorePicker.module.css';

/** Primer arranque del dispositivo: se elige en qué sucursal opera. Se puede cambiar desde Ajustes. */
export function StorePicker() {
  const { stores, selectStore } = useDevice();

  return (
    <div className={styles.wrap}>
      <div className={styles.panel}>
        <div className={styles.brand}>
          <Logo />
        </div>
        <h1>¿En qué sucursal está este dispositivo?</h1>
        <p className="muted">Todas las ventas y movimientos que registres acá quedarán asociados a esta sucursal.</p>
        <div className={styles.list}>
          {stores.map((s) => (
            <button key={s.id} className={styles.option} onClick={() => selectStore(s.id)}>
              <Icon name="store" size={22} />
              <span className={styles.name}>{s.name}</span>
              <span className={styles.code}>{s.code}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
