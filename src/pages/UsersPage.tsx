import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useDevice } from '@/contexts/DeviceContext';
import { listUsers } from '@/database/repositories/users';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { UserFormModal } from '@/components/users/UserFormModal';
import { ROLE_LABELS } from '@/services/permissions';
import type { User } from '@/types/domain';
import styles from './UsersPage.module.css';

export function UsersPage() {
  const users = useLiveQuery(listUsers, [], []);
  const { stores } = useDevice();
  // undefined = cerrado, null = usuario nuevo.
  const [editing, setEditing] = useState<User | null | undefined>(undefined);

  return (
    <>
      <PageHeader
        title="Usuarios"
        subtitle="Quién entra al sistema y qué puede hacer"
        actions={
          <Button variant="primary" icon="plus" onClick={() => setEditing(null)}>
            Nuevo
          </Button>
        }
      />
      <Card className={styles.list}>
        {users.map((u) => (
          <button key={u.id} type="button" className={styles.row} onClick={() => setEditing(u)}>
            <span className={styles.main}>
              <strong>{u.name}</strong>
              <span className="muted">
                {u.username} · {stores.find((s) => s.id === u.store_id)?.name ?? 'Todas las sucursales'}
              </span>
            </span>
            {!u.active && <Badge tone="danger">Inactivo</Badge>}
            {Object.keys(u.permissions).length > 0 && <Badge tone="accent">Permisos a medida</Badge>}
            <Badge>{ROLE_LABELS[u.role]}</Badge>
          </button>
        ))}
      </Card>
      {editing !== undefined && <UserFormModal key={editing?.id ?? 'new'} user={editing} onClose={() => setEditing(undefined)} />}
    </>
  );
}
