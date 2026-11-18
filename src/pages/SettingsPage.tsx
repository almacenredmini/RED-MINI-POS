import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useDevice } from '@/contexts/DeviceContext';
import { useToast } from '@/contexts/ToastContext';
import { Card } from '@/components/ui/Card';
import { SyncCard } from '@/components/sync/SyncCard';
import { Field, Input, Select } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { PageHeader } from '@/components/ui/PageHeader';
import { getStorageEstimate, requestPersistentStorage } from '@/services/storage';
import { applyTheme, getTheme, type Theme } from '@/services/theme';
import { getPrintSettings, savePrintSettings, type PrintSettings } from '@/services/printSettings';
import { printHtml, sampleTicket } from '@/services/ticket';
import { Button, ButtonLink } from '@/components/ui/Button';
import { BackupError, downloadBackup, getLastBackup, parseBackup, restoreBackup, type BackupFile } from '@/services/backup';
import { Modal } from '@/components/ui/Modal';
import styles from './SettingsPage.module.css';

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function SettingsPage() {
  const { deviceId, stores, currentStore, selectStore } = useDevice();
  const toast = useToast();
  const { can, canSwitchStore, user } = useAuth();
  const [theme, setTheme] = useState<Theme>(getTheme);
  const [storage, setStorage] = useState<Awaited<ReturnType<typeof getStorageEstimate>>>(null);

  const refreshStorage = () => void getStorageEstimate().then(setStorage);
  useEffect(refreshStorage, []);

  return (
    <>
      <PageHeader title="Ajustes" subtitle="Configuración de este dispositivo" />
      <div className={styles.grid}>
        {(can('users.manage') || can('stock.adjust') || can('purchases.manage') || can('accounts.manage')) && (
          <Card title="Administración">
            <div className={styles.links}>
              {can('accounts.manage') && <ButtonLink to="/cuentas" icon="store">Cuentas</ButtonLink>}
              {can('stock.adjust') && <ButtonLink to="/inventario" icon="inventory">Inventario</ButtonLink>}
              {can('purchases.manage') && <ButtonLink to="/compras" icon="purchases">Compras</ButtonLink>}
              {can('users.manage') && <ButtonLink to="/usuarios" icon="store">Usuarios</ButtonLink>}
            </div>
          </Card>
        )}
        <SyncCard />
        {user?.role === 'owner' && <BackupCard />}
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

        <PrintCard storeName={currentStore?.name ?? ''} storeAddress={currentStore?.address ?? null} />

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

/** Impresora de tickets de este dispositivo: ancho del papel y textos del ticket. */
function PrintCard({ storeName, storeAddress }: { storeName: string; storeAddress: string | null }) {
  const [settings, setSettings] = useState<PrintSettings>(getPrintSettings);
  const update = (patch: Partial<PrintSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    savePrintSettings(next);
  };

  return (
    <Card title="Impresora de tickets">
      <div className={styles.form}>
        <Field label="Ancho del papel">
          {(id) => (
            <Select id={id} value={settings.paper} onChange={(e) => update({ paper: e.target.value === '80' ? 80 : 58 })}>
              <option value={58}>58 mm</option>
              <option value={80}>80 mm</option>
            </Select>
          )}
        </Field>
        <Field label="Título del ticket">
          {(id) => <Input id={id} value={settings.title} onChange={(e) => update({ title: e.target.value })} maxLength={32} autoComplete="off" />}
        </Field>
        <Field label="Encabezado" hint="Debajo del título. Una línea por renglón: teléfono, Instagram, CUIT…">
          {(id) => <textarea id={id} className={styles.textarea} rows={3} value={settings.header} onChange={(e) => update({ header: e.target.value })} maxLength={200} />}
        </Field>
        <Field label="Pie del ticket">
          {(id) => <textarea id={id} className={styles.textarea} rows={2} value={settings.footer} onChange={(e) => update({ footer: e.target.value })} maxLength={200} />}
        </Field>
        <div>
          <Button icon="pos" onClick={() => printHtml(sampleTicket(storeName, storeAddress, settings))}>
            Imprimir ticket de prueba
          </Button>
        </div>
        <details className={styles.help}>
          <summary>Imprimir sin que aparezca la ventana de impresión</summary>
          <ol>
            <li>En Windows, poné la impresora de tickets como <strong>predeterminada</strong>.</li>
            <li>
              Hacé clic derecho en el acceso directo de la app → Propiedades. En <strong>Destino</strong>, agregá al final, después de un espacio:{' '}
              <code>--kiosk-printing</code>
            </li>
            <li>Cerrá todas las ventanas de Chrome y abrí la app desde ese acceso directo.</li>
          </ol>
          <p className="muted">Mientras tanto, al imprimir aparece la ventana de Chrome: elegí la impresora de tickets y tocá Imprimir.</p>
        </details>
      </div>
    </Card>
  );
}

const DAY = 24 * 60 * 60 * 1000;
const RESTORE_LABELS = { products: 'Productos', sales: 'Ventas', cash_sessions: 'Cajas', users: 'Usuarios' };

/** Copia de seguridad en la PC: sólo el dueño, porque el archivo tiene todos los datos, usuarios incluidos. */
function BackupCard() {
  const toast = useToast();
  const [last, setLast] = useState(getLastBackup);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ name: string; backup: BackupFile } | null>(null);
  const [restoring, setRestoring] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const old = !last || Date.now() - last.getTime() > 7 * DAY;

  return (
    <Card title="Copia de seguridad">
      <div className={styles.form}>
        <p className="muted">
          Descarga a esta PC un archivo con todos los datos: productos, ventas, cajas, stock, compras, cuentas, usuarios y horarios. Guardalo en un pendrive
          o en tu correo, y no se lo pases a nadie.
        </p>
        <dl className={styles.dl}>
          <dt>Última copia</dt>
          <dd>
            {last ? last.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : 'Nunca'}{' '}
            {old && <Badge tone="warning">Hacé una</Badge>}
          </dd>
        </dl>
        <div>
          <Button
            icon="inventory"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const size = await downloadBackup(__APP_VERSION__);
                setLast(getLastBackup() ?? new Date());
                toast(`Copia descargada (${mb(size)})`, 'success');
              } catch {
                toast('No se pudo armar la copia', 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Armando la copia…' : 'Descargar copia'}
          </Button>
        </div>
        <p className="muted">Conviene hacerla una vez por semana, en la PC de la sucursal donde más se vende.</p>
        <details className={styles.help}>
          <summary>Recuperar datos desde una copia</summary>
          <p className="muted">
            Sólo para emergencias: si se perdieron datos del servidor o de este dispositivo. No borra nada: agrega lo que falta y, cuando termina, lo sube
            al servidor para que les llegue a todos.
          </p>
          <div>
            <Button icon="inventory" onClick={() => fileRef.current?.click()}>
              Restaurar copia…
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              try {
                setPending({ name: file.name, backup: parseBackup(await file.text()) });
              } catch (err) {
                toast(err instanceof BackupError ? err.message : 'No se pudo leer el archivo', 'error');
              }
            }}
          />
        </details>
      </div>
      <Modal
        open={pending !== null}
        title="Restaurar copia"
        onClose={() => !restoring && setPending(null)}
        footer={
          <>
            <Button onClick={() => setPending(null)} disabled={restoring}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              disabled={restoring}
              onClick={async () => {
                if (!pending) return;
                setRestoring(true);
                try {
                  const r = await restoreBackup(pending.backup);
                  toast(r.restored > 0 ? `Listo: se recuperaron ${r.restored} registros. Se están subiendo al servidor.` : 'Listo: este dispositivo ya tenía todo lo de la copia', 'success');
                  setPending(null);
                } catch {
                  toast('No se pudo restaurar la copia. No se cambió nada.', 'error');
                } finally {
                  setRestoring(false);
                }
              }}
            >
              {restoring ? 'Restaurando…' : 'Sí, restaurar'}
            </Button>
          </>
        }
      >
        {pending && (
          <div className={styles.form}>
            <p>
              Copia <strong>{pending.name}</strong>, del{' '}
              <strong>{new Date(pending.backup.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</strong>
            </p>
            <dl className={styles.dl}>
              {(['products', 'sales', 'cash_sessions', 'users'] as const).map((t) => (
                <div key={t} style={{ display: 'contents' }}>
                  <dt>{RESTORE_LABELS[t]}</dt>
                  <dd className="num">{pending.backup.tables[t]?.length ?? 0}</dd>
                </div>
              ))}
            </dl>
            <p className="muted">
              No se borra nada. Lo que en este dispositivo esté más nuevo que en la copia se conserva. Puede tardar unos segundos si la copia es grande.
            </p>
          </div>
        )}
      </Modal>
    </Card>
  );
}
