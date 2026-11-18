import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { CategoryError, ensureCategory, listCategories, renameCategory } from './categories';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('renombrar categoría', () => {
  it('cambia el nombre, conserva el id y lo manda a sincronizar', async () => {
    const c = await ensureCategory('Gaseosa');
    await renameCategory(c.id, '  Gaseosas   y aguas ');
    const [renamed] = await listCategories();
    expect(renamed).toMatchObject({ id: c.id, name: 'Gaseosas y aguas' });
    const queued = await db.sync_queue.filter((q) => q.record_id === c.id).toArray();
    expect(queued.at(-1)?.payload).toMatchObject({ name: 'Gaseosas y aguas' });
  });

  it('no deja repetir el nombre de otra categoría ni dejarlo vacío', async () => {
    await ensureCategory('Bebidas');
    const c = await ensureCategory('Lácteos');
    await expect(renameCategory(c.id, 'bebidas')).rejects.toBeInstanceOf(CategoryError);
    await expect(renameCategory(c.id, '   ')).rejects.toBeInstanceOf(CategoryError);
    await renameCategory(c.id, 'lacteos'); // la misma, con otras mayúsculas/acentos: vale
    expect((await db.categories.get(c.id))?.name).toBe('lacteos');
  });
});
