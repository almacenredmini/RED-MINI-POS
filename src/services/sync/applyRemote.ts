import type { Table } from 'dexie';
import { db } from '@/database/db';
import { applyRemoteStockMovements } from '@/database/repositories/stock';
import { buildSearchWords } from '@/services/search';
import type { Product, StockMovement, SyncTable } from '@/types/domain';
import type { PullChange } from './transport';

type Row = Record<string, unknown> & { id: string };

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/;

/**
 * PostgreSQL devuelve "2026-11-04T13:38:00.123+00:00". Localmente todo es ISO con Z,
 * porque los índices de fecha comparan como texto: los dos formatos juntos ordenarían mal.
 */
function normalize(row: Record<string, unknown>): Row {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = typeof value === 'string' && TIMESTAMP.test(value) ? new Date(value).toISOString() : value;
  }
  return out as Row;
}

/** Gana la versión más alta y, si empatan, el cambio más reciente: la misma regla que el servidor. */
function remoteWins(local: Row, remote: Row): boolean {
  const remoteVersion = Number(remote.version ?? 0);
  const localVersion = Number(local.version ?? 0);
  if (remoteVersion !== localVersion) return remoteVersion > localVersion;
  return String(remote.updated_at ?? '') >= String(local.updated_at ?? '');
}

/** Un conflicto de código o de usuario entre dispositivos no puede frenar toda la descarga. */
async function putUnique(table: Table, row: Row, field: string, pending: Set<string>, name: SyncTable): Promise<void> {
  const clash = (await table.where(field).equals(row[field] as string).first()) as Row | undefined;
  if (clash && clash.id !== row.id) {
    // El cambio local todavía no se resolvió: el servidor lo va a rechazar y queda a la vista como error.
    if (pending.has(`${name}:${clash.id}`)) return;
    await table.delete(clash.id);
  }
  await table.put(row);
}

const UNIQUE_FIELD: Partial<Record<SyncTable, string>> = { barcodes: 'code', users: 'username', stores: 'code', sales: 'number' };

const MUTABLE: SyncTable[] = ['stores', 'users', 'categories', 'products', 'barcodes', 'suppliers', 'purchases', 'employee_accounts', 'sales', 'cash_sessions'];
const IMMUTABLE: SyncTable[] = ['sale_items', 'payments', 'product_cost_history', 'account_movements', 'purchase_items', 'cash_movements'];

/**
 * Aplica una página de cambios del servidor en una sola transacción. No encola nada:
 * lo que llega del servidor no se vuelve a subir.
 */
export async function applyRemoteChanges(changes: PullChange[]): Promise<void> {
  if (changes.length === 0) return;
  const tables = [...MUTABLE, ...IMMUTABLE].map((t) => db.table(t));

  await db.transaction('rw', [...tables, db.stock, db.stock_movements, db.sync_queue], async () => {
    // Un registro con cambios locales sin subir no se pisa: primero se sube y el servidor decide.
    const pending = new Set((await db.sync_queue.toArray()).map((e) => `${e.table}:${e.record_id}`));
    const movements: StockMovement[] = [];

    for (const change of changes) {
      const row = normalize(change.row);

      if (change.table.startsWith('deleted:')) {
        await db.table(change.table.slice('deleted:'.length)).delete(row.id);
        continue;
      }
      if (change.table === 'stock_movements') {
        movements.push(row as unknown as StockMovement);
        continue;
      }

      const name = change.table as SyncTable;
      if (IMMUTABLE.includes(name)) {
        await db.table(name).put(row);
        continue;
      }
      if (!MUTABLE.includes(name) || pending.has(`${name}:${row.id}`)) continue;

      const table = db.table(name);
      const local = (await table.get(row.id)) as Row | undefined;
      if (local && !remoteWins(local, row)) continue;

      if (name === 'products') {
        const p = row as unknown as Product;
        // Campos que sólo existen en el dispositivo y no viajan al servidor.
        p.search_words = buildSearchWords(p.name, p.brand, p.sku);
        p.has_image = (local as unknown as Product | undefined)?.has_image ?? false;
      }

      const unique = UNIQUE_FIELD[name];
      if (unique) await putUnique(table, row, unique, pending, name);
      else await table.put(row);
    }

    await applyRemoteStockMovements(movements);
  });
}
