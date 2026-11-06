import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { seedAdminIfEmpty } from '../seed';
import { hasPermission } from '@/services/permissions';
import { authenticate, saveUser, type UserInput } from './users';

const emp: UserInput = { username: 'Juan', name: 'Juan', role: 'employee', permissions: {}, store_id: 'store-1', active: true, password: 'abc' };

beforeEach(async () => {
  await db.delete();
  await db.open();
  await seedAdminIfEmpty();
});

describe('usuarios', () => {
  it('crea admin / 1234 una sola vez y sin guardar la contraseña en claro', async () => {
    await seedAdminIfEmpty();
    expect(await db.users.count()).toBe(1);
    const admin = await authenticate('admin', '1234');
    expect(admin?.role).toBe('owner');
    expect(admin?.password_hash.startsWith('pbkdf2$')).toBe(true);
    expect(await authenticate('admin', 'mala')).toBeNull();
    expect(await authenticate('nadie', '1234')).toBeNull();
  });

  it('un usuario desactivado no entra', async () => {
    const u = await saveUser(emp);
    expect(await authenticate('JUAN ', 'abc')).not.toBeNull();
    await saveUser({ ...emp, active: false, password: '' }, u.id);
    expect(await authenticate('juan', 'abc')).toBeNull();
  });

  it('un empleado necesita sucursal y el Dueño nunca queda fijo en una', async () => {
    await expect(saveUser({ ...emp, store_id: null })).rejects.toThrow('sucursal');
    const owner = await saveUser({ ...emp, username: 'socio', role: 'owner' });
    expect(owner.store_id).toBeNull();
  });

  it('editar sin contraseña conserva la anterior', async () => {
    const u = await saveUser(emp);
    await saveUser({ ...emp, name: 'Juan P', password: '' }, u.id);
    expect((await authenticate('juan', 'abc'))?.name).toBe('Juan P');
  });

  it('rechaza usuario repetido y dejar el sistema sin Dueño', async () => {
    await saveUser(emp);
    await expect(saveUser(emp)).rejects.toThrow('ya existe');
    const admin = await authenticate('admin', '1234');
    await expect(saveUser({ ...emp, username: 'admin', name: 'A', role: 'employee', password: '' }, admin!.id)).rejects.toThrow('Dueño');
  });

  it('las excepciones por usuario ganan sobre el rol, salvo en el Dueño', () => {
    const base = { active: true, permissions: {} };
    expect(hasPermission({ ...base, role: 'employee' }, 'sales.discount')).toBe(false);
    expect(hasPermission({ ...base, role: 'employee', permissions: { 'sales.discount': true } }, 'sales.discount')).toBe(true);
    expect(hasPermission({ ...base, role: 'manager', permissions: { 'sales.void': false } }, 'sales.void')).toBe(false);
    expect(hasPermission({ ...base, role: 'owner', permissions: { 'users.manage': false } }, 'users.manage')).toBe(true);
    expect(hasPermission({ ...base, role: 'owner', active: false }, 'users.manage')).toBe(false);
  });
});
