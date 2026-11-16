import { db } from '@/database/db';
import { enqueueMany, type OutboxItem } from '@/database/outbox';
import { toSyncProduct } from '@/database/repositories/products';
import { applyRemoteStockMovements } from '@/database/repositories/stock';
import { IMMUTABLE, MUTABLE } from '@/services/sync/applyRemote';
import type { Product, StockMovement, SyncTable } from '@/types/domain';

/**
 * Copia de seguridad local: todas las tablas de datos en un solo archivo JSON que se descarga a la PC.
 * Quedan afuera la cola de sincronización y los ajustes internos del dispositivo (no son datos del negocio).
 * Las fotos y archivos (Blob) se guardan como texto base64 para que el archivo esté completo.
 */
const SKIP = new Set(['sync_queue', 'meta']);
const LAST_KEY = 'redmini.lastBackup';

export interface BackupFile {
  app: 'red-mini-pos';
  format: 1;
  created_at: string;
  app_version: string;
  tables: Record<string, unknown[]>;
}

interface EncodedBlob {
  __blob: string;
  type: string;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function encodeRow(row: unknown): Promise<unknown> {
  if (!row || typeof row !== 'object') return row;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v instanceof Blob ? ({ __blob: await blobToBase64(v), type: v.type } satisfies EncodedBlob) : v;
  }
  return out;
}

export async function buildBackup(appVersion: string): Promise<BackupFile> {
  const tables: Record<string, unknown[]> = {};
  for (const table of db.tables) {
    if (SKIP.has(table.name)) continue;
    const rows = await table.toArray();
    tables[table.name] = await Promise.all(rows.map(encodeRow));
  }
  return { app: 'red-mini-pos', format: 1, created_at: new Date().toISOString(), app_version: appVersion, tables };
}

/** "redmini-copia-2026-11-15-1430.json" */
export function backupFilename(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `redmini-copia-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}

export async function downloadBackup(appVersion: string): Promise<number> {
  const backup = await buildBackup(appVersion);
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFilename();
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  try {
    localStorage.setItem(LAST_KEY, backup.created_at);
  } catch {
    /* sin almacenamiento: sólo no recordamos la fecha */
  }
  return blob.size;
}

export function getLastBackup(): Date | null {
  try {
    const v = localStorage.getItem(LAST_KEY);
    return v ? new Date(v) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Restaurar
// ---------------------------------------------------------------------------

export class BackupError extends Error {}

type Row = Record<string, unknown> & { id?: string };

/** Lee el archivo y verifica que sea una copia de RED MINI pos. */
export function parseBackup(text: string): BackupFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError('El archivo no es una copia de seguridad válida');
  }
  const b = data as Partial<BackupFile>;
  if (b?.app !== 'red-mini-pos' || !b.tables || typeof b.tables !== 'object') throw new BackupError('El archivo no es una copia de RED MINI pos');
  if (b.format !== 1) throw new BackupError('Esta copia es de una versión más nueva: actualizá la app primero');
  return b as BackupFile;
}

function base64ToBlob(b64: string, type: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

function decodeRow(row: unknown): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    const enc = v as Partial<EncodedBlob> | null;
    out[k] = enc && typeof enc === 'object' && typeof enc.__blob === 'string' ? base64ToBlob(enc.__blob, enc.type ?? '') : v;
  }
  return out;
}

/** Misma regla que la sincronización: gana la versión más alta y, si empatan, la más reciente. */
function backupWins(local: Row, incoming: Row): boolean {
  const lv = Number(local.version ?? 0);
  const iv = Number(incoming.version ?? 0);
  if (lv !== iv) return iv > lv;
  return String(incoming.updated_at ?? '') > String(local.updated_at ?? '');
}

const UNIQUE_FIELD: Partial<Record<SyncTable, string>> = { barcodes: 'code', users: 'username', stores: 'code', sales: 'number' };
/** Tablas que sólo viven en el dispositivo: se completan las que falten. El stock se recalcula con los movimientos. */
const LOCAL_ONLY = ['store_min_stock', 'product_images', 'purchase_files'];

export interface RestoreResult {
  restored: number;
  kept: number;
  queued: number;
}

/**
 * Recupera una copia SIN borrar nada: agrega lo que falta y actualiza lo que en la copia está más nuevo.
 * Lo que en este dispositivo está más nuevo se conserva. Después encola todo para subirlo:
 * si el servidor está vacío lo recupera completo, y si ya lo tiene, lo ignora.
 */
export async function restoreBackup(backup: BackupFile): Promise<RestoreResult> {
  const result: RestoreResult = { restored: 0, kept: 0, queued: 0 };
  const rowsOf = (name: string) => ((backup.tables[name] ?? []) as unknown[]).map(decodeRow);
  const synced = [...MUTABLE, ...IMMUTABLE];
  const tables = [...synced, 'stock_movements', 'stock', ...LOCAL_ONLY].map((t) => db.table(t));

  await db.transaction('rw', [...tables, db.sync_queue], async () => {
    const outbox: OutboxItem[] = [];

    for (const name of synced) {
      const table = db.table(name);
      const unique = UNIQUE_FIELD[name];
      for (const row of rowsOf(name)) {
        if (typeof row.id !== 'string') continue;
        const local = (await table.get(row.id)) as Row | undefined;
        let current = local;
        if (!local || (MUTABLE.includes(name) && backupWins(local, row))) {
          // Un código o usuario repetido con otro id: se respeta el que ya está en el dispositivo.
          const clash = unique && !local ? ((await table.where(unique).equals(row[unique] as string).first()) as Row | undefined) : undefined;
          if (clash && clash.id !== row.id) {
            result.kept++;
            continue;
          }
          await table.put(row);
          current = row;
          result.restored++;
        } else {
          result.kept++;
        }
        const payload = name === 'products' ? toSyncProduct(current as unknown as Product) : current;
        outbox.push({ table: name, record_id: row.id, op: 'upsert', payload });
      }
    }

    // Los movimientos de stock que falten suman al stock, igual que si llegaran del servidor.
    const movements = rowsOf('stock_movements') as unknown as StockMovement[];
    const before = await db.stock_movements.count();
    await applyRemoteStockMovements(movements);
    const added = (await db.stock_movements.count()) - before;
    result.restored += added;
    result.kept += movements.length - added;
    for (const m of movements) outbox.push({ table: 'stock_movements', record_id: m.id, op: 'upsert', payload: m });

    for (const name of LOCAL_ONLY) {
      const table = db.table(name);
      const key = table.schema.primKey.keyPath as string;
      for (const row of rowsOf(name)) {
        if (await table.get(row[key] as string)) {
          result.kept++;
          continue;
        }
        await table.put(row);
        result.restored++;
      }
    }

    await enqueueMany(outbox);
    result.queued = outbox.length;
  });
  return result;
}
