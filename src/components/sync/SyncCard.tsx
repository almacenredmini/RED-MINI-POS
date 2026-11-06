import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCurrentStore, useDevice } from '@/contexts/DeviceContext';
import { useToast } from '@/contexts/ToastContext';
import { db } from '@/database/db';
import { getMeta } from '@/database/meta';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Field';
import { useSyncStatus } from '@/components/layout/SyncIndicator';
import { clearSyncConfig, decodeLinkCode, encodeLinkCode, getSyncConfig, LAST_SYNC_KEY, saveSyncConfig } from '@/services/sync/config';
import { requeueErrors, syncNow } from '@/services/sync/engine';
import { signIn } from '@/services/sync/supabase';
import { SyncAuthError, SyncNetworkError } from '@/services/sync/transport';
import styles from './SyncCard.module.css';

const ALL_STORES = 'all';

function LinkForm() {
  const store = useCurrentStore();
  const { stores } = useDevice();
  const [code, setCode] = useState('');
  const [url, setUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [scope, setScope] = useState(store.id);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onCode = (value: string) => {
    setCode(value);
    const conn = decodeLinkCode(value);
    if (conn) {
      setUrl(conn.url);
      setAnonKey(conn.anon_key);
    }
  };

  const link = async () => {
    setBusy(true);
    setError(null);
    try {
      const conn = { url: url.trim().replace(/\/+$/, ''), anon_key: anonKey.trim() };
      const session = await signIn(conn, email.trim(), password);
      await saveSyncConfig({ ...conn, email: email.trim(), session, scope_store_id: scope === ALL_STORES ? null : scope });
      setPassword('');
      void syncNow();
    } catch (e) {
      setError(e instanceof SyncAuthError || e instanceof SyncNetworkError ? e.message : 'No se pudo vincular. Revisá la dirección y la clave.');
      setBusy(false);
    }
  };

  return (
    <div className={styles.form}>
      <p className="muted">Conectá este dispositivo para que sus cambios lleguen a los demás. Las ventas siguen funcionando sin Internet.</p>
      <Field label="Código de vinculación" hint="Si ya vinculaste otro dispositivo, copiá el código desde ahí y no hace falta completar la dirección ni la clave.">
        {(id) => <Input id={id} value={code} onChange={(e) => onCode(e.target.value)} autoComplete="off" />}
      </Field>
      <Field label="Dirección del proyecto">{(id) => <Input id={id} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" autoComplete="off" />}</Field>
      <Field label="Clave pública (anon)">{(id) => <Input id={id} value={anonKey} onChange={(e) => setAnonKey(e.target.value)} autoComplete="off" />}</Field>
      <Field label="Correo de la cuenta de sincronización">{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />}</Field>
      <Field label="Contraseña de esa cuenta" hint="No se guarda en este dispositivo.">{(id) => <Input id={id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />}</Field>
      <Field label="Qué guarda este dispositivo">
        {(id) => (
          <Select id={id} value={scope} onChange={(e) => setScope(e.target.value)}>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                PC de {s.name}: catálogo y sólo lo de esa sucursal
              </option>
            ))}
            <option value={ALL_STORES}>Celular del dueño: todas las sucursales</option>
          </Select>
        )}
      </Field>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <Button variant="primary" disabled={busy || !url || !anonKey || !email || !password} onClick={() => void link()}>
        {busy ? 'Vinculando…' : 'Vincular dispositivo'}
      </Button>
    </div>
  );
}

function LinkedStatus() {
  const toast = useToast();
  const { stores } = useDevice();
  const status = useSyncStatus();
  const config = useLiveQuery(getSyncConfig, []);
  const lastSync = useLiveQuery(() => getMeta<string>(LAST_SYNC_KEY), []);
  const queue = useLiveQuery(() => db.sync_queue.toArray(), [], []);
  const errors = queue.filter((e) => e.status === 'error');
  const [confirming, setConfirming] = useState(false);

  if (!config) return null;
  const scopeName = config.scope_store_id ? `Sólo ${stores.find((s) => s.id === config.scope_store_id)?.name ?? 'una sucursal'}` : 'Todas las sucursales';

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(encodeLinkCode(config));
      toast('Código copiado', 'success');
    } catch {
      toast('No se pudo copiar el código', 'error');
    }
  };

  return (
    <div className={styles.form}>
      <dl className={styles.dl}>
        <dt>Cuenta</dt>
        <dd>{config.email}</dd>
        <dt>Guarda</dt>
        <dd>{scopeName}</dd>
        <dt>Estado</dt>
        <dd>
          {status.state === 'syncing' ? <Badge tone="accent" dot>Sincronizando</Badge> : status.message ? <Badge tone="warning" dot>{status.message}</Badge> : <Badge tone="success" dot>Conectado</Badge>}
        </dd>
        <dt>Última vez</dt>
        <dd className="num">{lastSync ? new Date(lastSync).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : 'Todavía no'}</dd>
        <dt>En cola</dt>
        <dd className="num">{queue.length - errors.length}</dd>
      </dl>

      {errors.length > 0 && (
        <div className={styles.errorsBox}>
          <strong>{errors.length} cambios rechazados por el servidor. Siguen guardados acá:</strong>
          <ul>
            {errors.slice(0, 10).map((e) => (
              <li key={e.id}>
                {e.table}: {e.last_error}
              </li>
            ))}
          </ul>
          <Button size="sm" onClick={() => void requeueErrors().then(syncNow)}>
            Reintentar
          </Button>
        </div>
      )}

      <div className={styles.actions}>
        <Button onClick={() => void syncNow()}>Sincronizar ahora</Button>
        <Button onClick={() => void copyCode()}>Copiar código de vinculación</Button>
        {confirming ? (
          <Button variant="danger" onClick={() => void clearSyncConfig().then(syncNow)}>
            Confirmar: desvincular
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => setConfirming(true)}>
            Desvincular
          </Button>
        )}
      </div>
    </div>
  );
}

export function SyncCard() {
  const config = useLiveQuery(async () => (await getSyncConfig()) ?? null, []);
  if (config === undefined) return null;
  return <Card title="Sincronización">{config ? <LinkedStatus /> : <LinkForm />}</Card>;
}
