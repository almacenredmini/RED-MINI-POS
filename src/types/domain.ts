/**
 * Modelo de dominio compartido por la base local (Dexie) y la remota (PostgreSQL).
 * Los nombres de campos son snake_case para que el mapeo 1:1 con SQL no necesite transformación.
 *
 * Convenciones:
 * - `id`: UUID v7 generado en el dispositivo (ordenable por tiempo).
 * - Montos: enteros en centavos (`*_cents`). Nunca float para dinero.
 * - Fechas: ISO 8601 UTC (string). Ordenable lexicográficamente.
 * - `deleted_at`: borrado lógico; nada se elimina físicamente para no romper la trazabilidad.
 */

export type UUID = string;
export type ISODate = string;
export type Cents = number;

export interface SyncMeta {
  created_at: ISODate;
  updated_at: ISODate;
  deleted_at: ISODate | null;
  /** Se incrementa en cada cambio local; base para detección de conflictos. */
  version: number;
  /** Dispositivo que hizo el último cambio. */
  updated_by_device: UUID;
}

export interface Store extends SyncMeta {
  id: UUID;
  code: string;
  name: string;
  address: string | null;
  active: boolean;
}

export interface Category extends SyncMeta {
  id: UUID;
  name: string;
  parent_id: UUID | null;
}

export type ProductUnit = 'unit' | 'kg' | 'l';

export interface Product extends SyncMeta {
  id: UUID;
  sku: string | null;
  name: string;
  brand: string | null;
  category_id: UUID | null;
  unit: ProductUnit;
  cost_cents: Cents;
  price_cents: Cents;
  /** Mínimo cargado a mano: vale siempre si auto_min_stock está apagado, y mientras no haya ventas si está prendido. */
  min_stock: number;
  auto_min_stock: boolean;
  /** Ruta en el storage remoto; la imagen local vive en `product_images`. */
  image_path: string | null;
  has_image: boolean;
  active: boolean;
  /** Índice derivado para búsqueda por prefijo de palabra. Sólo local. */
  search_words: string[];
}

export interface Barcode extends SyncMeta {
  id: UUID;
  code: string;
  product_id: UUID;
  /** Cantidad de unidades que representa (pack x6 => 6). */
  pack_qty: number;
}

export interface StockLevel {
  /** `${store_id}:${product_id}` — clave compuesta local. */
  id: string;
  store_id: UUID;
  product_id: UUID;
  quantity: number;
  updated_at: ISODate;
}

/** Mínimo calculado con las ventas de una sucursal. Se deriva de las ventas: no se sincroniza. */
export interface StoreMinStock {
  /** `${store_id}:${product_id}` */
  id: string;
  store_id: UUID;
  product_id: UUID;
  min_stock: number;
  weekly_avg: number;
  computed_at: ISODate;
}

export interface ProductImage {
  product_id: UUID;
  blob: Blob;
  updated_at: ISODate;
}

export type SyncOperation = 'upsert' | 'delete';
export type SyncStatus = 'pending' | 'in_flight' | 'error';

export interface SyncQueueEntry {
  /** Autoincremental local: garantiza orden FIFO de envío. */
  seq?: number;
  id: UUID;
  table: SyncTable;
  record_id: UUID;
  op: SyncOperation;
  payload: unknown;
  status: SyncStatus;
  attempts: number;
  last_error: string | null;
  created_at: ISODate;
}

export type SyncTable = 'stores' | 'categories' | 'products' | 'barcodes' | 'users' | 'sales' | 'sale_items' | 'payments' | 'stock_movements' | 'suppliers' | 'purchases' | 'purchase_items' | 'product_cost_history' | 'employee_accounts' | 'account_movements';

export type UserRole = 'owner' | 'manager' | 'employee';

export interface User extends SyncMeta {
  id: UUID;
  /** Siempre en minúsculas. */
  username: string;
  name: string;
  password_hash: string;
  role: UserRole;
  /** Excepciones al rol: true otorga, false revoca. */
  permissions: Record<string, boolean>;
  /** null = puede moverse entre sucursales; con valor, queda fijo en esa (cajero). */
  store_id: UUID | null;
  active: boolean;
}

export type StockMovementType = 'initial' | 'sale' | 'sale_void' | 'purchase' | 'purchase_return' | 'adjustment' | 'transfer_out' | 'transfer_in';

export interface StockMovement {
  id: UUID;
  store_id: UUID;
  product_id: UUID;
  type: StockMovementType;
  /** Con signo: negativo resta stock. */
  quantity: number;
  unit_cost_cents: Cents | null;
  reason: string | null;
  reference_type: 'sale' | 'purchase' | 'transfer' | 'count' | null;
  reference_id: UUID | null;
  /** Vincula la salida y la entrada de una transferencia. */
  transfer_id?: UUID;
  /** Sólo en `adjustment`: distingue entrada, salida y conteo. */
  kind?: 'entry' | 'exit' | 'count';
  user_id: UUID | null;
  device_id: UUID;
  occurred_at: ISODate;
}

export interface Supplier extends SyncMeta {
  id: UUID;
  name: string;
  tax_id: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
}

export type PurchaseStatus = 'draft' | 'received' | 'cancelled';
export type InvoiceType = 'A' | 'B' | 'C' | 'X' | 'remito';

export interface Purchase extends SyncMeta {
  id: UUID;
  store_id: UUID;
  supplier_id: UUID | null;
  status: PurchaseStatus;
  invoice_type: InvoiceType | null;
  invoice_number: string | null;
  /** YYYY-MM-DD */
  invoice_date: string | null;
  /** Ruta en el storage remoto; la foto local vive en `purchase_files`. */
  invoice_path: string | null;
  subtotal_cents: Cents;
  tax_cents: Cents;
  total_cents: Cents;
  received_at: ISODate | null;
  received_by: UUID | null;
  notes: string | null;
}

export interface PurchaseItem {
  id: UUID;
  purchase_id: UUID;
  product_id: UUID;
  quantity: number;
  unit_cost_cents: Cents;
  total_cents: Cents;
  updated_at: ISODate;
}

export interface PurchaseFile {
  purchase_id: UUID;
  blob: Blob;
  updated_at: ISODate;
}

export interface ProductCost {
  id: UUID;
  product_id: UUID;
  supplier_id: UUID | null;
  purchase_id: UUID | null;
  cost_cents: Cents;
  effective_at: ISODate;
  device_id: UUID;
}

export type SaleStatus = 'completed' | 'voided';

export interface Sale {
  id: UUID;
  store_id: UUID;
  device_id: UUID;
  user_id: UUID | null;
  number: string;
  status: SaleStatus;
  subtotal_cents: Cents;
  discount_cents: Cents;
  total_cents: Cents;
  occurred_at: ISODate;
  voided_at: ISODate | null;
  voided_by: UUID | null;
  void_reason: string | null;
  created_at: ISODate;
  updated_at: ISODate;
  version: number;
  updated_by_device: UUID;
}

export interface SaleItem {
  id: UUID;
  sale_id: UUID;
  line: number;
  product_id: UUID | null;
  barcode: string | null;
  /** Snapshot: nombre, precio y costo quedan como estaban al vender. */
  description: string;
  quantity: number;
  unit_price_cents: Cents;
  unit_cost_cents: Cents;
  discount_cents: Cents;
  total_cents: Cents;
}

/** `card` es el cobro con tarjeta sin distinguir débito/crédito. */
export type PaymentMethod = 'cash' | 'card' | 'debit' | 'credit' | 'transfer' | 'mercadopago' | 'employee_account';

export interface Payment {
  id: UUID;
  sale_id: UUID;
  method: PaymentMethod;
  /** Lo imputado a la venta (sin vuelto). */
  amount_cents: Cents;
  /** Lo entregado por el cliente en efectivo. */
  tendered_cents: Cents | null;
  /** Sólo en `employee_account`. */
  account_id?: UUID;
  occurred_at: ISODate;
}

export interface EmployeeAccount extends SyncMeta {
  id: UUID;
  name: string;
  limit_cents: Cents;
  active: boolean;
}

export interface AccountMovement {
  id: UUID;
  account_id: UUID;
  type: 'charge' | 'charge_void' | 'settlement';
  /** Positivo suma deuda; negativo la baja. */
  amount_cents: Cents;
  sale_id: UUID | null;
  store_id: UUID;
  user_id: UUID | null;
  device_id: UUID;
  note: string | null;
  occurred_at: ISODate;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}
