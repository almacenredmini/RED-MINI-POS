import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrentStore } from '@/contexts/DeviceContext';
import { useToast } from '@/contexts/ToastContext';
import { db } from '@/database/db';
import { InventoryError, registerManualMovement } from '@/database/repositories/inventory';
import { stockKey } from '@/database/repositories/stores';
import { findProductByBarcode } from '@/database/repositories/products';
import { CameraScanner } from '@/scanner/CameraScanner';
import { useKeyboardWedge } from '@/scanner/useKeyboardWedge';
import { scanFeedback } from '@/scanner/feedback';
import { ButtonLink, Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatMoney } from '@/services/money';
import { parseQuantity } from '@/services/quantity';
import type { Product } from '@/types/domain';
import styles from './ScanPage.module.css';

type Result = { code: string; product: Product | null };

/**
 * Flujo de depósito desde el celular: escanear → ver producto o darlo de alta.
 * Para quien tiene permiso, permite cargar stock ahí mismo y seguir escaneando.
 */
export function ScanPage() {
  const [result, setResult] = useState<Result | null>(null);
  const [manual, setManual] = useState('');
  const [quantity, setQuantity] = useState('');
  // Paso intermedio: quien carga en varias sucursales confirma en cuál va a sumar antes de guardar.
  const [confirming, setConfirming] = useState(false);
  const store = useCurrentStore();
  const { user, can } = useAuth();
  const toast = useToast();
  const productId = result?.product?.id;
  const current = useLiveQuery(async () => (productId ? ((await db.stock.get(stockKey(store.id, productId)))?.quantity ?? 0) : 0), [productId, store.id], 0);

  const addStock = async () => {
    const qty = parseQuantity(quantity);
    if (!result?.product || qty === null) return toast('Ingresá una cantidad válida', 'error');
    try {
      const total = await registerManualMovement({ kind: 'entry', storeId: store.id, product: result.product, quantity: qty, reason: 'Carga desde Escanear', userId: user?.id ?? null });
      toast(`${result.product.name}: stock en ${store.name} ${total}`, 'success');
      setQuantity('');
      setConfirming(false);
      setResult(null);
    } catch (e) {
      toast(e instanceof InventoryError ? e.message : 'No se pudo cargar el stock', 'error');
    }
  };

  const requestAdd = () => {
    if (parseQuantity(quantity) === null) return toast('Ingresá una cantidad válida', 'error');
    if (confirming) void addStock();
    else setConfirming(true);
  };

  const onCode = async (code: string) => {
    const product = (await findProductByBarcode(code)) ?? null;
    if (!product) scanFeedback(false);
    setQuantity('');
    setConfirming(false);
    setResult({ code, product });
  };

  useKeyboardWedge({ onScan: (c) => void onCode(c) });

  return (
    <>
      <PageHeader title="Escanear" subtitle="Apuntá la cámara al código de barras" />
      <div className={styles.layout}>
        <CameraScanner onDetected={(c) => void onCode(c)} paused={result !== null} />
        <Input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !manual.trim()) return;
            void onCode(manual.trim());
            setManual('');
          }}
          placeholder="O escribí el código y Enter"
          inputMode="numeric"
          autoComplete="off"
          aria-label="Código de barras"
        />

        {result && (
          <Card className={styles.result}>
            {result.product ? (
              <div className={styles.found}>
                <div className={styles.info}>
                  <strong>{result.product.name}</strong>
                  <span className={`${styles.price} num`}>{formatMoney(result.product.price_cents)}</span>
                  <span className="muted num">Stock en {store.name}: {current}</span>
                </div>
              </div>
            ) : (
              <div className={styles.missing}>
                <strong>Producto no registrado</strong>
                <span className="muted num">Código {result.code}</span>
              </div>
            )}
            {result.product && can('stock.adjust') &&
              (confirming ? (
                <div className={styles.confirm} role="alert">
                  <p>
                    ¿Sumar <strong className="num">{parseQuantity(quantity)}</strong> a <strong>{store.name}</strong>?
                    <span className="muted num"> Queda en {current + (parseQuantity(quantity) ?? 0)}.</span>
                  </p>
                  <div className={styles.addStock}>
                    <Button onClick={() => setConfirming(false)}>Cambiar</Button>
                    <Button variant="primary" icon="check" onClick={() => void addStock()} autoFocus>
                      Sí, sumar en {store.name}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className={styles.addStock}>
                  <Input
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && requestAdd()}
                    placeholder="Cantidad que entra"
                    inputMode="decimal"
                    autoComplete="off"
                    aria-label="Cantidad que entra"
                  />
                  <Button variant="primary" icon="plus" disabled={parseQuantity(quantity) === null} onClick={requestAdd}>
                    Agregar stock
                  </Button>
                </div>
              ))}
            <div className={styles.actions}>
              <Button onClick={() => setResult(null)}>Escanear otro</Button>
              {result.product ? (
                <ButtonLink to={`/productos/${result.product.id}`}>
                  Ver / editar
                </ButtonLink>
              ) : (
                <ButtonLink to={`/productos/nuevo?codigo=${encodeURIComponent(result.code)}`} variant="primary" icon="plus">
                  Crear producto
                </ButtonLink>
              )}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
