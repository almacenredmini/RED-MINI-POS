import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useDevice } from '@/contexts/DeviceContext';
import { useToast } from '@/contexts/ToastContext';
import { Card } from '@/components/ui/Card';
import { SyncCard } from '@/components/sync/SyncCard';
import { Field, Select } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { PageHeader } from '@/components/ui/PageHeader';
import { getStorageEstimate, requestPersistentStorage } from '@/services/storage';
import { applyTheme, getTheme, type Theme } from '@/services/theme';
import { Button, ButtonLink } from '@/components/ui/Button';
import styles from './SettingsPage.module.css';

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function SettingsPage() {
  const { deviceId, stores, currentStore, selectStore } = useDevice();
  const toast = useToast();
  const { can, canSwitchStore } = useAuth();
  const [theme, setTheme] = useState<Theme>(getTheme);
  const [storage, setStorage] = useState<Awaited<ReturnType<typeof getStorageEstimate>>>(null);

  const refreshStorage = () => void getStorageEstimate().then(setStorage);
  useEffect(refreshStorage, []);

  return (
    <>
      <PageHeader title="Ajustes" subtitle="Configuración de este dispositivo" />
      <div className={styles.grid}>
        {(can('users.manage') || can('sales.void') || can('stock.adjust') || can('purchases.manage') || can('accounts.manage')) && (
          <Card title="Administración">
            <div className={styles.links}>
              {can('sales.void') && <ButtonLink to="/ventas" icon="purchases">Ventas</ButtonLink>}
              {can('accounts.manage') && <ButtonLink to="/cuentas" icon="store">Cuentas</ButtonLink>}
              {can('stock.adjust') && <ButtonLink to="/inventario" icon="inventory">Inventario</ButtonLink>}
              {can('purchases.manage') && <ButtonLink to="/compras" icon="purchases">Compras</ButtonLink>}
              {can('users.manage') && <ButtonLink to="/usuarios" icon="store">Usuarios</ButtonLink>}
            </div>
          </Card>
        )}
        <SyncCard />
        <Card title="Sucursal">
          <Field label="Este dispositivo opera en" hint={canSwitchStore ? 'Cambiarlo afecta dónde se registran ventas y stock.' : 'Este usuario o este dispositivo está fijo en esta sucursal.'}>
            {(id) => (
              <Select
                id={id}
                value={currentStore?.id ?? ''}
                disabled={!canSwitchStore}
                onChange={async (e) => {
                  await selectStore(e.target.value);
                  toast('Sucursal actualizada', 'success');
                }}
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </Card>

        <Card title="Apariencia">
          <Field label="Tema">
            {(id) => (
              <Select
                id={id}
                value={theme}
                onChange={(e) => {
                  const t = e.target.value as Theme;
                  setTheme(t);
                  applyTheme(t);
                }}
              >
                <option value="dark">Oscuro</option>
                <option value="light">Claro</option>
              </Select>
            )}
          </Field>
        </Card>

        <Card title="Almacenamiento local">
          <dl className={styles.dl}>
            <dt>Persistente</dt>
            <dd>
              {storage?.persisted ? (
                <Badge tone="success">Protegido</Badge>
              ) : (
                <Button
                  size="sm"
                  onClick={async () => {
                    const ok = await requestPersistentStorage();
                    toast(ok ? 'Almacenamiento protegido' : 'El navegador no lo permitió. Instalá la app para protegerlo.', ok ? 'success' : 'error');
                    refreshStorage();
                  }}
                >
                  Proteger
                </Button>
              )}
            </dd>
            <dt>Uso</dt>
            <dd className="num">{storage ? `${mb(storage.usage)} de ${mb(storage.quota)}` : '—'}</dd>
            <dt>ID dispositivo</dt>
            <dd className={`${styles.mono} num`}>{deviceId}</dd>
            <dt>Versión</dt>
            <dd className="num">{__APP_VERSION__}</dd>
          </dl>
        </Card>
      </div>
    </>
  );
}
