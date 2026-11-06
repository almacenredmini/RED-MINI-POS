import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '@/components/ui/Button';
import styles from './UpdatePrompt.module.css';

/**
 * registerType 'prompt': la nueva versión no se activa sola.
 * Así nunca se recarga la página en medio de una venta; el usuario elige cuándo actualizar.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (reg) setInterval(() => void reg.update(), 60 * 60 * 1000);
    },
  });

  if (!needRefresh) return null;
  return (
    <div className={styles.bar} role="alert">
      <span>Hay una nueva versión disponible.</span>
      <div className={styles.actions}>
        <Button size="sm" variant="ghost" onClick={() => setNeedRefresh(false)}>
          Después
        </Button>
        <Button size="sm" variant="primary" onClick={() => void updateServiceWorker(true)}>
          Actualizar
        </Button>
      </div>
    </div>
  );
}
