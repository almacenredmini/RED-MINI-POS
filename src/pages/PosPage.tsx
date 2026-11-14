import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrentStore } from '@/contexts/DeviceContext';
import { useToast } from '@/contexts/ToastContext';
import { db } from '@/database/db';
import { AccountError } from '@/database/repositories/accounts';
import { findProductByBarcode } from '@/database/repositories/products';
import { createSale } from '@/database/repositories/sales';
import { useCart } from '@/hooks/useCart';
import { useHotkeys } from '@/hooks/useHotkeys';
import { scanFeedback } from '@/scanner/feedback';
import { ScannerModal } from '@/scanner/ScannerModal';
import { useKeyboardWedge } from '@/scanner/useKeyboardWedge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { CartLines } from '@/components/pos/CartLines';
import { DiscountModal } from '@/components/pos/DiscountModal';
import { PaymentModal } from '@/components/pos/PaymentModal';
import { ProductSearchModal } from '@/components/pos/ProductSearchModal';
import { addLine, cartTotals, changeQuantity, EMPTY_CART, removeLine } from '@/services/cart';
import { uuidv7 } from '@/services/id';
import { formatMoney } from '@/services/money';
import type { PaymentDraft } from '@/services/payment';
import { printHtml, renderTicketHtml } from '@/services/ticket';
import type { Product } from '@/types/domain';
import styles from '@/components/pos/Pos.module.css';

type Dialog = 'search' | 'pay' | 'discount' | 'camera' | null;

/** Un lector escribe mucho más rápido: un + o - pegado a otra tecla es parte de un código, no un atajo. */
const MIN_MANUAL_KEY_GAP_MS = 120;

/** En un celular, enfocar el recuadro abriría el teclado y taparía la venta. */
const hasPhysicalKeyboard = () => window.matchMedia('(hover: hover)').matches;

export function PosPage() {
  const store = useCurrentStore();
  const { user, can } = useAuth();
  const toast = useToast();
  const { cart, setCart, loaded } = useCart();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [saleId, setSaleId] = useState(uuidv7);
  const keyGap = useRef(Infinity);
  const [code, setCode] = useState('');
  const [searchText, setSearchText] = useState('');
  const box = useRef<HTMLInputElement>(null);

  /** Vuelve al recuadro salvo que haya un diálogo abierto o el usuario esté en otro campo. */
  const focusBox = useCallback(() => {
    if (!hasPhysicalKeyboard() || document.querySelector('dialog[open]')) return;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLSelectElement) return;
    box.current?.focus();
  }, []);

  const totals = cartTotals(cart);
  const canDiscount = can('sales.discount');
  const selected = cart.lines.find((l) => l.product_id === selectedId) ?? cart.lines.at(-1) ?? null;

  const addProduct = (p: Product, barcode: string | null) => {
    setCart((c) => addLine(c, { product_id: p.id, name: p.name, barcode, unit: p.unit, unit_price_cents: p.price_cents, unit_cost_cents: p.cost_cents }));
    setSelectedId(p.id);
  };

  const addByCode = async (code: string, beep: boolean) => {
    const p = await findProductByBarcode(code);
    if (!p || !p.active) {
      const message = p ? `"${p.name}" está inactivo` : `Código ${code} no registrado`;
      scanFeedback(false);
      toast(message, 'error');
      setLastScan(message);
      return;
    }
    if (beep) scanFeedback(true);
    addProduct(p, code);
    setLastScan(`Agregado: ${p.name}`);
  };

  /** Código exacto: se agrega. Otro texto: abre la búsqueda con lo escrito. */
  const onBoxKeyDown = async (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const text = code.trim();
    setCode('');
    if (!text) return;
    if (/^\d+$/.test(text) || (await findProductByBarcode(text))) return void (await addByCode(text, true));
    setSearchText(text);
    setDialog('search');
  };

  const openPayment = () => {
    if (cart.lines.length === 0) return toast('Agregá un producto para vender', 'info');
    setDialog('pay');
  };

  const closeSale = async (payments: PaymentDraft[], print: boolean) => {
    try {
      const detail = await createSale({ id: saleId, store, userId: user?.id ?? null, cart, payments });
      setCart(EMPTY_CART);
      setSelectedId(null);
      setSaleId(uuidv7());
      setDialog(null);
      toast(`Venta ${detail.sale.number} guardada`, 'success');
      // La impresión va después de guardar: si la impresora falla, la venta ya está registrada.
      if (print) {
        try {
          printHtml(renderTicketHtml({ ...detail, storeName: store.name, storeAddress: store.address, cashier: user?.name ?? null }));
        } catch {
          toast('La venta se guardó, pero no se pudo imprimir', 'error');
        }
      }
    } catch (e) {
      setDialog(null);
      toast(e instanceof AccountError ? e.message : 'No se pudo guardar la venta. Volvé a intentar.', 'error');
    }
  };

  const clearCart = () => {
    setCart(EMPTY_CART);
    setSelectedId(null);
  };

  useKeyboardWedge({ onScan: (code) => void addByCode(code, true), enabled: dialog === null });

  const whenIdle = (action: () => void) => () => {
    if (dialog === null) action();
  };

  // Este efecto va antes que useHotkeys para que el intervalo ya esté medido cuando llega el atajo.
  useEffect(() => {
    let last = 0;
    const onKey = () => {
      const now = performance.now();
      keyGap.current = now - last;
      last = now;
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // Con el recuadro vacío, + y - manejan la cantidad; con texto se escriben, como en "coca-cola".
  const manualKey = (action: () => void) => (e: KeyboardEvent) => {
    const inOtherField = e.target instanceof HTMLInputElement && e.target !== box.current;
    if (inOtherField || code !== '' || dialog !== null || keyGap.current <= MIN_MANUAL_KEY_GAP_MS) return false;
    action();
  };

  useEffect(() => {
    if (dialog === null && loaded) focusBox();
  }, [dialog, loaded, focusBox]);

  // Al volver de otra ventana o del diálogo de impresión, el cajero sigue listo para escanear.
  useEffect(() => {
    window.addEventListener('focus', focusBox);
    return () => window.removeEventListener('focus', focusBox);
  }, [focusBox]);

  const moveSelection = (delta: number) => {
    if (!selected) return;
    const next = cart.lines[cart.lines.indexOf(selected) + delta];
    if (next) setSelectedId(next.product_id);
  };

  // Con el cobro abierto, F1/F2/F10/F12 los atiende PaymentModal.
  useHotkeys(
    dialog === 'pay'
      ? {}
      : {
          F10: whenIdle(() => {
            setSearchText('');
            setDialog('search');
          }),
          F12: whenIdle(openPayment),
          '+': manualKey(() => selected && setCart((c) => changeQuantity(c, selected.product_id, 1))),
          '-': manualKey(() => selected && setCart((c) => changeQuantity(c, selected.product_id, -1))),
          ArrowUp: whenIdle(() => moveSelection(-1)),
          ArrowDown: whenIdle(() => moveSelection(1)),
        },
  );

  return (
    <div className={styles.pos}>
      <section className={styles.cart}>
        <Input
          ref={box}
          className={styles.codeBox}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => void onBoxKeyDown(e)}
          // El timeout deja que el foco termine de moverse antes de decidir si hay que recuperarlo.
          onBlur={() => setTimeout(focusBox, 0)}
          placeholder="Escaneá o escribí el código y Enter"
          autoComplete="off"
          aria-label="Código de barras"
        />
        <div className={styles.toolbar}>
          <Button
            icon="search"
            onClick={() => {
              setSearchText('');
              setDialog('search');
            }}
          >
            Buscar <kbd className={styles.kbd}>F10</kbd>
          </Button>
          <Button icon="scan" onClick={() => setDialog('camera')}>
            Cámara
          </Button>
          {cart.lines.length > 0 && (
            <Button variant="ghost" icon="trash" onClick={clearCart}>
              Vaciar
            </Button>
          )}
        </div>

        {loaded && cart.lines.length === 0 ? (
          <EmptyState icon="scan" title="Escaneá un producto para empezar">
            <p>El recuadro de arriba ya está listo. Para buscar por nombre, escribilo ahí o apretá F10.</p>
          </EmptyState>
        ) : (
          <CartLines
            lines={cart.lines}
            selectedId={selected?.product_id ?? null}
            onSelect={setSelectedId}
            onChange={(id, delta) => setCart((c) => changeQuantity(c, id, delta))}
            onRemove={(id) => setCart((c) => removeLine(c, id))}
          />
        )}
      </section>

      <aside className={styles.summary}>
        {totals.discount > 0 && (
          <>
            <div className={`${styles.summaryRow} num`}>
              <span>Subtotal</span>
              <span>{formatMoney(totals.subtotal)}</span>
            </div>
            <div className={`${styles.summaryRow} num`}>
              <span>Descuento</span>
              <span>-{formatMoney(totals.discount)}</span>
            </div>
          </>
        )}
        <div className={styles.summaryRow}>
          <span>{totals.units} {totals.units === 1 ? 'unidad' : 'unidades'}</span>
          {canDiscount && (
            <Button size="sm" variant="ghost" onClick={() => setDialog('discount')} disabled={cart.lines.length === 0}>
              Descuento
            </Button>
          )}
        </div>
        <div className={`${styles.total} num`}>{formatMoney(totals.total)}</div>
        <Button variant="primary" size="lg" block disabled={cart.lines.length === 0} onClick={openPayment}>
          Vender <kbd className={styles.kbdDark}>F12</kbd>
        </Button>
      </aside>

      {dialog === 'search' && (
        <ProductSearchModal
          storeId={store.id}
          initialQuery={searchText}
          onClose={() => setDialog(null)}
          onPick={(p) => {
            void db.barcodes.where('product_id').equals(p.id).first().then((b) => addProduct(p, b?.code ?? null));
            setDialog(null);
          }}
        />
      )}
      {dialog === 'pay' && <PaymentModal total={totals.total} onClose={() => setDialog(null)} onConfirm={closeSale} />}
      {dialog === 'discount' && canDiscount && <DiscountModal current={cart.discount} onApply={(discount) => setCart((c) => ({ ...c, discount }))} onClose={() => setDialog(null)} />}
      <ScannerModal open={dialog === 'camera'} continuous status={lastScan} onClose={() => setDialog(null)} onDetected={(code) => void addByCode(code, false)} />
    </div>
  );
}
