import { useState } from 'react';
import { saveUser, UserValidationError } from '@/database/repositories/users';
import { useDevice } from '@/contexts/DeviceContext';
import { useToast } from '@/contexts/ToastContext';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { hasPermission, PERMISSIONS, roleGrants, ROLE_LABELS, type PermissionKey } from '@/services/permissions';
import type { User, UserRole } from '@/types/domain';
import styles from './UserFormModal.module.css';

const GROUPS = [...new Set(PERMISSIONS.map((p) => p.group))];

export function UserFormModal({ user, onClose }: { user: User | null; onClose: () => void }) {
  const toast = useToast();
  const { stores, currentStore } = useDevice();
  const [username, setUsername] = useState(user?.username ?? '');
  const [name, setName] = useState(user?.name ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>(user?.role ?? 'employee');
  const [overrides, setOverrides] = useState<Record<string, boolean>>(user?.permissions ?? {});
  const [active, setActive] = useState(user?.active ?? true);
  const [storeId, setStoreId] = useState<string | null>(user?.store_id ?? (role === 'employee' ? (currentStore?.id ?? null) : null));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** Sólo se guarda la diferencia con el rol: si después cambian los permisos del rol, el usuario los hereda. */
  const toggle = (key: PermissionKey, value: boolean) => {
    setOverrides((o) => {
      const next = { ...o };
      if (value === roleGrants(role, key)) delete next[key];
      else next[key] = value;
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveUser({ username, name, role, permissions: overrides, store_id: storeId, active, password }, user?.id);
      toast(user ? 'Usuario actualizado' : 'Usuario creado', 'success');
      onClose();
    } catch (e) {
      setError(e instanceof UserValidationError ? e.message : 'No se pudo guardar el usuario');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title={user ? `Editar ${user.name}` : 'Nuevo usuario'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <Field label="Nombre">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} data-autofocus />}</Field>
        <Field label="Usuario">{(id) => <Input id={id} value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoComplete="off" />}</Field>
        <Field label="Contraseña" hint={user ? 'Dejala vacía para no cambiarla' : undefined}>
          {(id) => <Input id={id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />}
        </Field>
        <Field label="Rol">
          {(id) => (
            <Select
              id={id}
              value={role}
              onChange={(e) => {
                const next = e.target.value as UserRole;
                setRole(next);
                setOverrides({});
                if (next === 'employee' && !storeId) setStoreId(currentStore?.id ?? null);
              }}
            >
              {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {role !== 'owner' && (
          <Field label="Sucursal" hint={role === 'employee' ? 'El empleado queda fijo en esta sucursal.' : 'Elegí una para dejarlo fijo, o Todas para que pueda cambiar.'}>
            {(id) => (
              <Select id={id} value={storeId ?? ''} onChange={(e) => setStoreId(e.target.value || null)}>
                {role !== 'employee' && <option value="">Todas las sucursales</option>}
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        {role === 'owner' ? (
          <p className="muted">El Dueño tiene todos los permisos y puede moverse entre sucursales.</p>
        ) : (
          GROUPS.map((group) => (
            <fieldset key={group} className={styles.group}>
              <legend>{group}</legend>
              {PERMISSIONS.filter((p) => p.group === group).map((p) => (
                <label key={p.key} className={styles.check}>
                  <input type="checkbox" checked={hasPermission({ role, permissions: overrides, active: true }, p.key)} onChange={(e) => toggle(p.key, e.target.checked)} />
                  {p.label}
                </label>
              ))}
            </fieldset>
          ))
        )}

        <label className={styles.check}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Usuario activo
        </label>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
