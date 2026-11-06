import { db } from './db';
import { getDeviceId } from './meta';
import { enqueue, newMeta } from './outbox';
import { hashPassword } from '@/services/password';
import type { Store, User } from '@/types/domain';

/**
 * IDs fijos para las sucursales iniciales: todos los dispositivos crean exactamente
 * el mismo registro, así la sincronización no genera duplicados.
 */
const INITIAL_STORES = [
  { id: '01930000-0000-7000-8000-000000000001', code: 'ORO', name: 'Oroño' },
  { id: '01930000-0000-7000-8000-000000000002', code: 'URI', name: 'Uriburu' },
] as const;

const ADMIN_ID = '01930000-0000-7000-8000-0000000000a1';

export async function seedIfEmpty(): Promise<void> {
  const deviceId = await getDeviceId();
  await db.transaction('rw', db.stores, db.sync_queue, async () => {
    if ((await db.stores.count()) > 0) return;
    for (const s of INITIAL_STORES) {
      const store: Store = { ...s, address: null, active: true, ...newMeta(deviceId) };
      await db.stores.add(store);
      await enqueue('stores', store.id, 'upsert', store);
    }
  });
}

/** Usuario inicial del dueño (admin / 1234). La contraseña se cambia desde Usuarios. */
export async function seedAdminIfEmpty(): Promise<void> {
  if ((await db.users.count()) > 0) return;
  const deviceId = await getDeviceId();
  // WebCrypto no puede esperarse dentro de una transacción Dexie: el hash se calcula antes.
  const password_hash = await hashPassword('1234');
  await db.transaction('rw', db.users, db.sync_queue, async () => {
    if ((await db.users.count()) > 0) return;
    const admin: User = {
      id: ADMIN_ID,
      username: 'admin',
      name: 'Administrador',
      password_hash,
      role: 'owner',
      permissions: {},
      store_id: null,
      active: true,
      ...newMeta(deviceId),
    };
    await db.users.add(admin);
    await enqueue('users', admin.id, 'upsert', admin);
  });
}
