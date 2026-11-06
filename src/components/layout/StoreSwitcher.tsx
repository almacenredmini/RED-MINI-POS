import { useAuth } from '@/contexts/AuthContext';
import { useDevice } from '@/contexts/DeviceContext';
import { Icon } from '@/components/ui/Icon';
import styles from './AppShell.module.css';

/** Quien puede moverse entre sucursales ve un selector; el cajero, sólo el nombre de la suya. */
export function StoreSwitcher() {
  const { stores, currentStore, selectStore } = useDevice();
  const { canSwitchStore } = useAuth();

  if (!canSwitchStore || stores.length < 2) {
    return (
      <span className={styles.storeChip}>
        <Icon name="store" size={16} />
        {currentStore?.name}
      </span>
    );
  }

  return (
    <label className={styles.storeChip}>
      <Icon name="store" size={16} />
      <select className={styles.storeSelect} aria-label="Sucursal" value={currentStore?.id ?? ''} onChange={(e) => void selectStore(e.target.value)}>
        {stores.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}
