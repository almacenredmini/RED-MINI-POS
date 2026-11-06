import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrentStore, useDevice } from '@/contexts/DeviceContext';
import { useToast } from '@/contexts/ToastContext';
import { db } from '@/database/db';
import { InventoryError, registerManualMovement, transferStock, type ManualKind } from '@/database/repositories/inventory';
import { stockKey } from '@/database/repositories/stores';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { parseQuantity } from '@/services/quantity';
import type { Product } from '@/types/domain';
import { ProductPicker } from './ProductPicker';
import styles from './Inventory.module.css';

export type MovementMode = ManualKind | 'transfer';

const COPY: Record<MovementMode, { title: string; quantity: string; reason: string; hint?: string }> = {
  entry: { title: 'Entrada de stock', quantity: 'Cantidad que entra', reason: 'Motivo (opcional)' },
  exit: { title: 'Salida de stock', quantity: 'Cantidad que sale', reason: 'Motivo', hint: 'Por ejemplo: rotura, vencimiento, consumo.' },
  count: { title: 'Ajuste por conteo', quantity: 'Cantidad real contada', reason: 'Motivo (opcional)', hint: 'El sistema registra la diferencia con el stock actual.' },
  transfer: { title: 'Transferencia', quantity: 'Cantidad a enviar', reason: 'Motivo (opcional)' },
};

export function MovementModal({ mode, onClose }: { mode: MovementMode; onClose: () => void }) {
  const store = useCurrentStore();
  const { stores } = useDevice();
  const { user } = useAuth();
  const toast = useToast();
  const destinations = stores.filter((s) => s.id !== store.id);

  const [product, setProduct] = useState<Product | null>(null);
  const [quantityText, setQuantityText] = useState('');
  const [reason, setReason] = useState('');
  const [toStoreId, setToStoreId] = useState(destinations[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const current = useLiveQuery(async () => (product ? ((await db.stock.get(stockKey(store.id, product.id)))?.quantity ?? 0) : 0), [product?.id, store.id], 0);
  const quantity = parseQuantity(quantityText);
  const copy = COPY[mode];

  const save = async () => {
    if (!product) return setError('Elegí un producto');
    if (quantity === null) return setError('Ingresá una cantidad válida');
    setSaving(true);
    setError(null);
    try {
      if (mode === 'transfer') {
        await transferStock({ fromStoreId: store.id, toStoreId, product, quantity, reason, userId: user?.id ?? null });
      } else {
        await registerManualMovement({ kind: mode, storeId: store.id, product, quantity, reason, userId: user?.id ?? null });
      }
      toast(`${copy.title}: ${product.name}`, 'success');
      onClose();
    } catch (e) {
      setError(e instanceof InventoryError ? e.message : 'No se pudo registrar el movimiento');
      setSaving(false);
    }
  };

  const after = quantity === null ? null : mode === 'entry' ? current + quantity : mode === 'count' ? quantity : current - quantity;

  return (
    <Modal
      open
      title={copy.title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Guardando…' : 'Registrar'}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        {product ? (
          <div className={styles.selected}>
            <span>
              <strong>{product.name}</strong>
              <span className="muted num"> · Stock en {store.name}: {current}</span>
            </span>
            <Button size="sm" variant="ghost" onClick={() => setProduct(null)}>
              Cambiar
            </Button>
          </div>
        ) : (
          <Field label="Producto">{(id) => <ProductPicker id={id} onPick={setProduct} autoFocus />}</Field>
        )}

        {mode === 'transfer' && (
          <Field label={`Desde ${store.name} hacia`}>
            {(id) => (
              <Select id={id} value={toStoreId} onChange={(e) => setToStoreId(e.target.value)}>
                {destinations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        <Field label={copy.quantity} hint={after !== null && product ? `Queda en ${store.name}: ${after}` : copy.hint}>
          {(id) => <Input id={id} inputMode="decimal" value={quantityText} onChange={(e) => setQuantityText(e.target.value)} autoComplete="off" />}
        </Field>
        <Field label={copy.reason}>{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} autoComplete="off" />}</Field>
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
