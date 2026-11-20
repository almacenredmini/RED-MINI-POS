import Dexie, { type EntityTable } from 'dexie';
import type {
  AccountMovement,
  CashMovement,
  CashSession,
  Barcode,
  Category,
  EmployeeAccount,
  MetaEntry,
  Product,
  ProductChange,
  StaffSchedule, SupplierInvoice, ScreenExit, SaleReturn, TaskTemplate, DayTask, TaskAssignment, CashPromo, ProductPromo, UnloadItem,
  ProductCost,
  Payment,
  ProductImage,
  Purchase,
  PurchaseFile,
  PurchaseItem,
  Sale,
  SaleItem,
  StockLevel,
  StockMovement,
  Store,
  StoreMinStock,
  Supplier,
  SyncQueueEntry,
  User,
} from '@/types/domain';

/**
 * Base local del dispositivo. Es la fuente de verdad operativa: la UI lee y escribe sólo acá.
 * La sincronización con PostgreSQL (Etapa 4) lee `sync_queue` y aplica cambios remotos.
 *
 * Reglas de versionado: nunca modificar una versión ya publicada; agregar `this.version(n+1)`
 * con `.upgrade()` si hace falta migrar datos.
 */
export class RedMiniDB extends Dexie {
  stores!: EntityTable<Store, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  products!: EntityTable<Product, 'id'>;
  barcodes!: EntityTable<Barcode, 'id'>;
  stock!: EntityTable<StockLevel, 'id'>;
  product_images!: EntityTable<ProductImage, 'product_id'>;
  sync_queue!: EntityTable<SyncQueueEntry, 'seq'>;
  meta!: EntityTable<MetaEntry, 'key'>;
  users!: EntityTable<User, 'id'>;
  sales!: EntityTable<Sale, 'id'>;
  sale_items!: EntityTable<SaleItem, 'id'>;
  payments!: EntityTable<Payment, 'id'>;
  stock_movements!: EntityTable<StockMovement, 'id'>;
  store_min_stock!: EntityTable<StoreMinStock, 'id'>;
  suppliers!: EntityTable<Supplier, 'id'>;
  purchases!: EntityTable<Purchase, 'id'>;
  purchase_items!: EntityTable<PurchaseItem, 'id'>;
  purchase_files!: EntityTable<PurchaseFile, 'purchase_id'>;
  product_cost_history!: EntityTable<ProductCost, 'id'>;
  product_changes!: EntityTable<ProductChange, 'id'>;
  staff_schedules!: EntityTable<StaffSchedule, 'id'>;
  supplier_invoices!: EntityTable<SupplierInvoice, 'id'>;
  screen_exits!: EntityTable<ScreenExit, 'id'>;
  sale_returns!: EntityTable<SaleReturn, 'id'>;
  task_templates!: EntityTable<TaskTemplate, 'id'>;
  day_tasks!: EntityTable<DayTask, 'id'>;
  task_assignments!: EntityTable<TaskAssignment, 'id'>;
  cash_promos!: EntityTable<CashPromo, 'id'>;
  product_promos!: EntityTable<ProductPromo, 'id'>;
  unload_items!: EntityTable<UnloadItem, 'id'>;
  employee_accounts!: EntityTable<EmployeeAccount, 'id'>;
  account_movements!: EntityTable<AccountMovement, 'id'>;
  cash_sessions!: EntityTable<CashSession, 'id'>;
  cash_movements!: EntityTable<CashMovement, 'id'>;

  constructor(name = 'red-mini-pos') {
    super(name);
    this.version(1).stores({
      stores: 'id, &code, updated_at',
      categories: 'id, name, parent_id, updated_at',
      products: 'id, name, brand, category_id, sku, updated_at, *search_words',
      barcodes: 'id, &code, product_id, updated_at',
      stock: 'id, store_id, product_id, [store_id+product_id]',
      product_images: 'product_id',
      sync_queue: '++seq, &id, status, [table+record_id], created_at',
      meta: 'key',
    });
    this.version(2).stores({
      users: 'id, &username, updated_at',
      sales: 'id, &number, [store_id+occurred_at], occurred_at, status',
      sale_items: 'id, sale_id, product_id',
      payments: 'id, sale_id, method',
      stock_movements: 'id, [store_id+product_id], product_id, reference_id, occurred_at',
    });
    this.version(3)
      .stores({ store_min_stock: 'id, store_id, product_id' })
      .upgrade(async (tx) => {
        await tx.table('products').toCollection().modify((p: Product) => {
          p.auto_min_stock ??= true;
        });
        await tx.table('users').toCollection().modify((u: User) => {
          u.store_id ??= null;
        });
      });
    this.version(4).stores({
      stock_movements: 'id, [store_id+product_id], [store_id+occurred_at], product_id, reference_id, occurred_at, transfer_id',
      suppliers: 'id, name, updated_at',
      purchases: 'id, [store_id+created_at], supplier_id, status',
      purchase_items: 'id, purchase_id, product_id',
      purchase_files: 'purchase_id',
      product_cost_history: 'id, product_id, effective_at',
    });
    this.version(5).stores({
      employee_accounts: 'id, name, updated_at',
      account_movements: 'id, account_id, sale_id, occurred_at',
    });
    this.version(6).stores({
      sales: 'id, &number, [store_id+occurred_at], occurred_at, status, cash_session_id',
      cash_sessions: 'id, device_id, [store_id+opened_at], opened_at',
      cash_movements: 'id, cash_session_id',
    });
    this.version(7).stores({
      product_changes: 'id, occurred_at, product_id',
    });
    this.version(8).stores({
      staff_schedules: 'id, store_id, name',
    });
    this.version(9).stores({
      supplier_invoices: 'id, store_id, issued_on',
    });
    this.version(10).stores({
      screen_exits: 'id, left_at, store_id',
    });
    this.version(11).stores({
      sale_returns: 'id, sale_id, sale_item_id, cash_session_id, occurred_at, [store_id+occurred_at]',
    });
    this.version(12).stores({
      task_templates: 'id, store_id',
      day_tasks: 'id, [store_id+day]',
    });
    this.version(13).stores({
      task_assignments: 'id, store_id',
    });
    this.version(14).stores({
      cash_promos: 'id, store_id',
    });
    this.version(15).stores({
      product_promos: 'id, store_id, product_id',
    });
    this.version(16).stores({
      unload_items: 'id, store_id, created_at',
    });
  }
}

export const db = new RedMiniDB();
