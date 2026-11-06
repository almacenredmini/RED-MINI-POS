import { db } from '../db';
import { getDeviceId } from '../meta';
import { enqueue, newMeta, touchMeta } from '../outbox';
import { uuidv7 } from '@/services/id';
import { hashPassword, verifyPassword } from '@/services/password';
import type { User, UserRole } from '@/types/domain';

export interface UserInput {
  username: string;
  name: string;
  role: UserRole;
  permissions: Record<string, boolean>;
  store_id: string | null;
  active: boolean;
  /** Obligatoria al crear; vacía al editar = no cambia. */
  password: string;
}

/** Errores de validación: su mensaje está pensado para mostrarse tal cual al usuario. */
export class UserValidationError extends Error {}

export const normalizeUsername = (u: string) => u.trim().toLowerCase();

export async function listUsers(): Promise<User[]> {
  return db.users.orderBy('username').toArray();
}

export async function authenticate(username: string, password: string): Promise<User | null> {
  const user = await db.users.where('username').equals(normalizeUsername(username)).first();
  if (!user || !user.active) return null;
  return (await verifyPassword(password, user.password_hash)) ? user : null;
}

export async function saveUser(input: UserInput, existingId?: string): Promise<User> {
  const username = normalizeUsername(input.username);
  if (!username) throw new UserValidationError('Ingresá un nombre de usuario');
  if (!input.name.trim()) throw new UserValidationError('Ingresá el nombre');
  if (!existingId && !input.password) throw new UserValidationError('Ingresá una contraseña');
  if (input.role === 'employee' && !input.store_id) throw new UserValidationError('Elegí la sucursal del empleado');

  const deviceId = await getDeviceId();
  const password_hash = input.password ? await hashPassword(input.password) : null;

  return db.transaction('rw', db.users, db.sync_queue, async () => {
    const taken = await db.users.where('username').equals(username).first();
    if (taken && taken.id !== existingId) throw new UserValidationError(`El usuario "${username}" ya existe`);

    const previous = existingId ? await db.users.get(existingId) : undefined;
    if (previous?.role === 'owner' && (input.role !== 'owner' || !input.active)) {
      const owners = await db.users.filter((u) => u.role === 'owner' && u.active).count();
      if (owners <= 1) throw new UserValidationError('Tiene que quedar al menos un Dueño activo');
    }

    const fields = {
      username,
      name: input.name.trim(),
      role: input.role,
      permissions: input.role === 'owner' ? {} : input.permissions,
      store_id: input.role === 'owner' ? null : input.store_id,
      active: input.active,
    };
    const user: User = previous
      ? { ...touchMeta(previous, deviceId), ...fields, password_hash: password_hash ?? previous.password_hash }
      : { id: uuidv7(), ...newMeta(deviceId), ...fields, password_hash: password_hash! };

    await db.users.put(user);
    await enqueue('users', user.id, 'upsert', user);
    return user;
  });
}
