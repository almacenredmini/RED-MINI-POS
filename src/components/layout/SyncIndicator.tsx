import { useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/database/db';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { Badge } from '@/components/ui/Badge';
import { getSyncConfig } from '@/services/sync/config';
import { getSyncStatus, subscribeSyncStatus } from '@/services/sync/engine';

export function usePendingSyncCount(): number {
  return useLiveQuery(() => db.sync_queue.count(), [], 0);
}

export function useSyncErrorCount(): number {
  return useLiveQuery(() => db.sync_queue.where('status').equals('error').count(), [], 0);
}

export function useSyncStatus() {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
}

export function SyncIndicator({ compact = false }: { compact?: boolean }) {
  const online = useOnlineStatus();
  const pending = usePendingSyncCount();
  const errors = useSyncErrorCount();
  const status = useSyncStatus();
  const linked = useLiveQuery(async () => (await getSyncConfig()) !== undefined, [], false);

  if (!linked) return <Badge dot>{compact ? 'Local' : 'Sin vincular · local'}</Badge>;
  if (!online) return <Badge tone="warning" dot>{compact ? 'Offline' : 'Sin conexión · guarda local'}</Badge>;
  if (status.state === 'auth_error') return <Badge tone="danger" dot>{compact ? 'Vincular' : 'Volvé a vincular'}</Badge>;
  if (errors > 0) return <Badge tone="danger" dot>{compact ? errors : `${errors} con error`}</Badge>;
  if (pending > 0) return <Badge tone="accent" dot>{compact ? pending : `${pending} por sincronizar`}</Badge>;
  return <Badge tone="success" dot>{compact ? 'OK' : 'Al día'}</Badge>;
}
