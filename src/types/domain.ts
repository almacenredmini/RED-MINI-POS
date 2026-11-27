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
  /** Horario de los turnos mañana y noche, de lunes (0) a domingo (6). null = ese día no hay ese turno. */
  shift_hours?: StoreShiftDay[] | null;
  /** Días especiales (feriados): por fecha `AAAA-MM-DD`, reemplazan el horario de ese día. */
  shift_overrides?: Record<string, StoreDayOverride> | null;
}

/** Un día especial del local: otro horario de turnos, o cerrado. */
export interface StoreDayOverride extends StoreShiftDay {
  closed: boolean;
  /** Ej.: "Feriado". */
  label: string | null;
}

export type ShiftName = 'morning' | 'night';

export interface StoreShiftDay {
  morning: Shift | null;
  night: Shift | null;
}

export interface Category extends SyncMeta {
  id: UUID;
  name: string;
  parent_id: UUID | null;
  /** Comestible: si no rota, avisa para revisar vencimientos. Las categorías viejas no lo tienen (= no). */
  perishable?: boolean;
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
  /**
   * false = stock ilimitado: no se descuenta al vender, no avisa faltantes y no suma al valor del inventario.
   * Los productos cargados antes de existir este campo no lo tienen: cuentan como `true`.
   */
  track_stock?: boolean;
  /** Índice derivado para búsqueda por prefijo de palabra. Sólo local. */
  search_words: string[];
}

export type PayPeriod = 'weekly' | 'biweekly' | 'monthly';

/** Un turno dentro de un día, en hora local "HH:MM". Si termina antes de empezar, cruza la medianoche. */
export interface Shift {
  start: string;
  end: string;
}

/** Horario semanal de una persona en una sucursal. Se repite todas las semanas. */
export interface StaffSchedule extends SyncMeta {
  id: UUID;
  store_id: UUID;
  /** Usuario del sistema, si tiene; si no, sólo el nombre. */
  user_id: UUID | null;
  name: string;
  /** Cómo cobra: define qué total se resalta. */
  pay_period: PayPeriod;
  /** De lunes (0) a domingo (6). */
  days: Shift[][];
  notes: string | null;
  /** Si tiene, el horario sale de los turnos del local (y `days` es sólo una copia de la semana base). */
  rotation?: Rotation | null;
  /** Cambios puntuales por fecha `AAAA-MM-DD`: ese día trabaja estos turnos ([] = franco). */
  overrides?: Record<string, Shift[]> | null;
}

/** Turno mañana o noche del local, los días que trabaja; si `rotates`, cambia de turno cada semana. */
export interface Rotation {
  /** Lunes (0) a domingo (6). */
  work_days: number[];
  /** El turno que hace la semana `week`. */
  shift: ShiftName;
  /** Lunes de esa semana, `AAAA-MM-DD`. */
  week: string;
  rotates: boolean;
}

/** Un artículo de una boleta de proveedor, tal como figura impreso. No se vincula con los productos. */
export interface SupplierInvoiceItem {
  name: string;
  quantity: number;
  unit_cents: Cents;
}

/** Boleta de proveedor: un registro para control. No toca stock ni costos, y la foto nunca se guarda. */
export interface SupplierInvoice extends SyncMeta {
  id: UUID;
  store_id: UUID;
  supplier_id: UUID | null;
  supplier_name: string;
  /** "AAAA-MM-DD" */
  issued_on: string | null;
  number: string | null;
  total_cents: Cents | null;
  items: SupplierInvoiceItem[];
  user_id: UUID | null;
}

/** Un cajero salió de la pantalla completa (minimizó, cambió de programa o salió con Esc/F11). Inmutable. */
export interface ScreenExit {
  id: UUID;
  store_id: UUID;
  user_id: UUID | null;
  /** Nombre al momento de salir: sigue legible aunque después lo renombren. */
  user_name: string;
  device_id: UUID;
  left_at: ISODate;
  returned_at: ISODate;
  seconds: number;
}

/**
 * Devolución de un producto de un ticket. Inmutable: el ticket original no se toca.
 * Resta de las ventas del día en que se devuelve y la plata sale de la caja donde se hizo.
 */
export interface SaleReturn {
  id: UUID;
  sale_id: UUID;
  sale_item_id: UUID;
  store_id: UUID;
  cash_session_id: UUID;
  /** null = producto común. */
  product_id: UUID | null;
  description: string;
  quantity: number;
  unit_price_cents: Cents;
  unit_cost_cents: Cents;
  /** Lo devuelto al cliente, con su parte del descuento general ya restada. */
  total_cents: Cents;
  /** `employee_account` sólo si el ticket se cobró entero a cuenta: baja la deuda en vez de dar efectivo. */
  refund_method: 'cash' | 'employee_account';
  account_id: UUID | null;
  reason: string;
  user_id: UUID | null;
  device_id: UUID;
  occurred_at: ISODate;
}

/** Planilla de pendientes de una sucursal: se repite todos los días. */
export interface TaskTemplate extends SyncMeta {
  id: UUID;
  store_id: UUID;
  title: string;
  position: number;
}

/**
 * Un pendiente de un día. Los de la planilla se crean recién cuando alguien los marca;
 * los agregados sólo para ese día (`template_id` null) se crean al agregarlos.
 */
export interface DayTask extends SyncMeta {
  id: UUID;
  store_id: UUID;
  /** `AAAA-MM-DD` en hora local. */
  day: string;
  template_id: UUID | null;
  title: string;
  created_by: UUID | null;
  done_by: UUID | null;
  /** Nombre al momento de marcarlo: sigue legible aunque después lo renombren. */
  done_by_name: string | null;
  done_at: ISODate | null;
}

/**
 * A quién le toca un pendiente de la planilla en una semana (los cajeros rotan).
 * Si una semana no tiene fila, vale la de la semana anterior más cercana.
 */
export interface TaskAssignment extends SyncMeta {
  id: UUID;
  store_id: UUID;
  /** Lunes de la semana, `AAAA-MM-DD`. */
  week: string;
  template_id: UUID;
  /** null = sin asignar a propósito. */
  user_id: UUID | null;
  user_name: string | null;
}

/**
 * Promo por pagar en efectivo: un % de descuento según el día y el horario. Lo que paga el cliente
 * se redondea para abajo (a su favor) para no tener que dar cambio chico.
 */
export interface CashPromo extends SyncMeta {
  id: UUID;
  store_id: UUID;
  active: boolean;
  /** 10 = 10%. */
  percent: number;
  /** Días en que vale: 0 = domingo … 6 = sábado. */
  days: number[];
  /** `HH:MM`; null = todo el día. Si `to_time` es menor que `from_time`, pasa la medianoche. */
  from_time: string | null;
  to_time: string | null;
  /** Múltiplo al que se redondea lo que paga (10000 = $100); 0 = sin redondeo. */
  round_cents: number;
  /** Formato viejo (antes de 0023): categorías sin promo. Se lee sólo si no hay `category_mode`. */
  excluded_category_ids?: UUID[];
  /** Formas de pago con las que vale. Sin dato = sólo efectivo (las promos viejas). */
  methods?: DiscountMethod[];
  /** 'all' = todo, 'only' = sólo `category_ids`, 'except' = todo menos `category_ids`. */
  category_mode?: 'all' | 'only' | 'except';
  category_ids?: UUID[];
}

/** Formas de pago a las que se les puede atar un descuento. */
export type DiscountMethod = 'cash' | 'card' | 'transfer';

/**
 * Promo por cantidad: el producto vale `unit_price_cents` c/u cuando se llevan entre `min_qty` y
 * `max_qty` unidades (null = sin tope), en una sucursal, desde `valid_from` hasta `valid_until` inclusive.
 */
export interface ProductPromo extends SyncMeta {
  id: UUID;
  store_id: UUID;
  product_id: UUID;
  unit_price_cents: Cents;
  min_qty: number;
  max_qty: number | null;
  /** `AAAA-MM-DD` */
  valid_from: string;
  valid_until: string;
}

/** Mercadería a descargar: una carga de stock hecha desde Escanear, con su casilla de "ya la bajé". */
export interface UnloadItem extends SyncMeta {
  id: UUID;
  store_id: UUID;
  product_id: UUID;
  /** Nombre al momento de cargar: la lista se lee aunque después cambien el producto. */
  product_name: string;
  quantity: number;
  movement_id: UUID | null;
  loaded_by: UUID | null;
  checked_at: ISODate | null;
  checked_by: UUID | null;
}

/** Cliente mayorista (se comparte entre sucursales). */
export interface WholesaleCustomer extends SyncMeta {
  id: UUID;
  name: string;
  phone: string | null;
  tax_id: string | null;
  address: string | null;
  notes: string | null;
}

export type WholesaleMethod = 'cash' | 'card' | 'transfer';

/** Renglón de un ticket mayorista: cantidad, costo y precio se cargan a mano para esa venta. */
export interface WholesaleItem {
  product_id: UUID | null;
  name: string;
  quantity: number;
  cost_cents: Cents;
  price_cents: Cents;
}

/**
 * Venta mayorista: una venta extraordinaria. No toca el stock, la caja ni las ventas del local;
 * en Reportes va aparte. Se ve desde cualquier sucursal.
 */
export interface WholesaleSale extends SyncMeta {
  id: UUID;
  store_id: UUID;
  number: string;
  customer_id: UUID | null;
  /** Nombre al momento de la venta, para que el ticket se lea igual aunque después cambie el cliente. */
  customer_name: string | null;
  occurred_at: ISODate;
  items: WholesaleItem[];
  total_cents: Cents;
  cost_cents: Cents;
  method: WholesaleMethod | null;
  /** null = el cliente lo debe. */
  paid_at: ISODate | null;
  user_id: UUID | null;
  notes: string | null;
  voided_at: ISODate | null;
  voided_by: UUID | null;
}

export type ProductChangeAction = 'created' | 'updated' | 'deleted';
/** De dónde vino el cambio. */
export type ProductChangeSource = 'manual' | 'import' | 'purchase' | 'bulk_price';

/** Registro inmutable de altas, modificaciones y bajas de productos (Reporte de movimientos). */
export interface ProductChange {
  id: UUID;
  product_id: UUID;
  /** Nombre al momento del cambio: sigue legible aunque después lo renombren o borren. */
  product_name: string;
  action: ProductChangeAction;
  /** Campo → [antes, después]. Vacío en altas y bajas. */
  changes: Record<string, [unknown, unknown]>;
  source: ProductChangeSource;
  user_id: UUID | null;
  device_id: UUID;
  occurred_at: ISODate;
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

export type SyncTable = 'stores' | 'categories' | 'products' | 'barcodes' | 'users' | 'sales' | 'sale_items' | 'payments' | 'stock_movements' | 'suppliers' | 'purchases' | 'purchase_items' | 'product_cost_history' | 'employee_accounts' | 'account_movements' | 'cash_sessions' | 'cash_movements' | 'product_changes' | 'staff_schedules' | 'supplier_invoices' | 'screen_exits' | 'sale_returns' | 'task_templates' | 'day_tasks' | 'task_assignments' | 'cash_promos' | 'product_promos' | 'shift_reports' | 'unload_items' | 'wholesale_customers' | 'wholesale_sales';

/**
 * Resumen de un turno cerrado, listo para mandar por mail. Sólo se sube (no se baja a los dispositivos):
 * en Supabase, al llegar, sale el mail (ver migración 0024).
 */
export interface ShiftReport {
  id: UUID;
  store_id: UUID;
  cash_session_id: UUID;
  subject: string;
  html: string;
  created_at: ISODate;
}

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

/**
 * Caja de un dispositivo: la abre el primer cajero que vende y la cierra con "Salir".
 * Hay una sola abierta por dispositivo; si el dueño vende mientras está abierta, entra en ella.
 */
export interface CashSession {
  id: UUID;
  store_id: UUID;
  device_id: UUID;
  opened_by: UUID | null;
  opened_at: ISODate;
  opening_cents: Cents;
  closed_by: UUID | null;
  closed_at: ISODate | null;
  /** Efectivo que debía haber, calculado al cerrar. */
  expected_cents: Cents | null;
  counted_cents: Cents | null;
  notes: string | null;
  created_at: ISODate;
  updated_at: ISODate;
  version: number;
  updated_by_device: UUID;
}

/** Retiro (o ingreso) de efectivo durante el turno. Inmutable. */
export interface CashMovement {
  id: UUID;
  cash_session_id: UUID;
  type: 'deposit' | 'withdrawal';
  amount_cents: Cents;
  reason: string;
  user_id: UUID | null;
  device_id: UUID;
  occurred_at: ISODate;
}

export interface Sale {
  id: UUID;
  store_id: UUID;
  device_id: UUID;
  /** Caja del dispositivo en la que entró la venta. Las ventas anteriores a la Etapa 5 no tienen. */
  cash_session_id?: UUID | null;
  user_id: UUID | null;
  number: string;
  status: SaleStatus;
  subtotal_cents: Cents;
  discount_cents: Cents;
  /** De dónde salió el descuento (ej. "Promo efectivo 10%"); null = manual. */
  discount_label?: string | null;
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
