/**
 * Lo único que el motor necesita del servidor. Cambiar de proveedor es escribir otra implementación:
 * ni el motor ni las pantallas saben que existe Supabase.
 */
export interface PushOp {
  id: string;
  table: string;
  record_id: string;
  op: string;
  payload: unknown;
  created_at: string;
}

export interface PushResult {
  id: string;
  result: 'applied' | 'duplicate' | 'conflict_resolved' | 'rejected';
  detail?: string;
}

export interface PullChange {
  table: string;
  seq: number;
  row: Record<string, unknown>;
}

export interface PullPage {
  changes: PullChange[];
  next_cursor: number;
  has_more: boolean;
}

export interface SyncTransport {
  push(deviceId: string, ops: PushOp[]): Promise<PushResult[]>;
  pull(cursor: number, storeId: string | null, limit: number): Promise<PullPage>;
}

/** Sin conexión o servidor caído: se reintenta solo. */
export class SyncNetworkError extends Error {}

/** La sesión venció o el correo no está autorizado: hace falta que alguien vuelva a vincular. */
export class SyncAuthError extends Error {}
