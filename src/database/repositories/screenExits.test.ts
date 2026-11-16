import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { flushPendingExit, formatDuration, listScreenExits, logScreenExit, readPendingExit, savePendingExit } from './screenExits';

// Las pruebas corren en Node, sin localStorage: una versión en memoria alcanza.
const memory = new Map<string, string>();
globalThis.localStorage ??= {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
  key: (i: number) => [...memory.keys()][i] ?? null,
  get length() {
    return memory.size;
  },
} as Storage;

beforeEach(async () => {
  await db.delete();
  await db.open();
  localStorage.clear();
});

const base = { store_id: 's1', user_id: 'u1', user_name: 'Cajero 1' };

describe('salidas de la pantalla de venta', () => {
  it('registra cuánto tiempo estuvo afuera y lo deja listo para subir', async () => {
    const e = await logScreenExit({ ...base, left_at: '2026-11-16T14:00:00.000Z', returned_at: '2026-11-16T14:03:30.000Z' });
    expect(e?.seconds).toBe(210);
    expect((await db.sync_queue.toArray()).map((q) => q.table)).toEqual(['screen_exits']);
    expect(await listScreenExits('s1', '2026-11-16T00:00:00.000Z', '2026-11-17T00:00:00.000Z')).toHaveLength(1);
    expect(await listScreenExits('s2', '2026-11-16T00:00:00.000Z', '2026-11-17T00:00:00.000Z')).toHaveLength(0);
  });

  it('no registra parpadeos de menos de 2 segundos', async () => {
    expect(await logScreenExit({ ...base, left_at: '2026-11-16T14:00:00.000Z', returned_at: '2026-11-16T14:00:01.000Z' })).toBeNull();
    expect(await db.screen_exits.count()).toBe(0);
  });

  it('si cerraron el programa estando afuera, lo registra al volver a abrir', async () => {
    savePendingExit({ ...base, left_at: '2026-11-16T14:00:00.000Z', last_seen: '2026-11-16T14:10:00.000Z' });
    await flushPendingExit();
    expect((await db.screen_exits.toArray()).map((e) => e.seconds)).toEqual([600]);
    expect(readPendingExit()).toBeNull();
  });

  it('muestra la duración en palabras', () => {
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(180)).toBe('3 min');
    expect(formatDuration(3900)).toBe('1 h 5 min');
  });
});
