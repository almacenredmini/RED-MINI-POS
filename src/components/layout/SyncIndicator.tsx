import { useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/database/db';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { Badge } from '@/components/ui/Badge';
import { getSyncConfig } from '@/services/sync/config';
import { getSyncStatus, subscribeSyncStatus, syncNow } from '@/services/sync/engine';
import styles from './SyncIndicator.module.css';

export function usePendingSyncCount(): number {
  return useLiveQuery(() => db.sync_queue.count(), [], 0);
}

export function useSyncErrorCount(): number {
  return useLiveQuery(() => db.sync_queue.where('status').equals('error').count(), [], 0);
}

export function useSyncStatus() {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
}

function StatusBadge({ compact }: { compact: boolean }) {
  const online = useOnlineStatus();
  const pending = usePendingSyncCount();
  const errors = useSyncErrorCount();
  const status = useSyncStatus();

  if (!online) return <Badge tone="warning" dot>{compact ? 'Offline' : 'Sin conexión · guarda local'}</Badge>;
  if (status.state === 'auth_error') return <Badge tone="danger" dot>{compact ? 'Vincular' : 'Volvé a vincular'}</Badge>;
  if (status.state === 'syncing') return <Badge tone="accent" dot>{compact ? '…' : 'Sincronizando'}</Badge>;
  if (errors > 0) return <Badge tone="danger" dot>{compact ? errors : `${errors} con error`}</Badge>;
  if (pending > 0) return <Badge tone="accent" dot>{compact ? pending : `${pending} por sincronizar`}</Badge>;
  return <Badge tone="success" dot>{compact ? 'OK' : 'Al día'}</Badge>;
}

/** Tocarlo sincroniza en el momento, sin esperar a la próxima vuelta automática. */
export function SyncIndicator({ compact = false }: { compact?: boolean }) {
  const linked = useLiveQuery(async () => (await getSyncConfig()) !== undefined, [], false);
  if (!linked) return <Badge dot>{compact ? 'Local' : 'Sin vincular · local'}</Badge>;
  return (
    <button type="button" className={styles.button} onClick={() => void syncNow()} aria-label="Sincronizar ahora" title="Sincronizar ahora">
      <StatusBadge compact={compact} />
    </button>
  );
}
