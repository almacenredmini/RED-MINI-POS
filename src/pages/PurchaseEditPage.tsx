import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrentStore } from '@/contexts/DeviceContext';
import { useToast } from '@/contexts/ToastContext';
import { db } from '@/database/db';
import { cancelPurchase, getPurchaseDetail, PurchaseError, savePurchase } from '@/database/repositories/purchases';
import { listSuppliers } from '@/database/repositories/suppliers';
import { useObjectUrl } from '@/hooks/useObjectUrl';
import { ProductPicker } from '@/components/inventory/ProductPicker';
import { SupplierModal } from '@/components/purchases/SupplierModal';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { compressImage } from '@/services/image';
import { centsToInput, formatMoney, parseMoney } from '@/services/money';
import { parseQuantity } from '@/services/quantity';
import type { InvoiceType, Purchase } from '@/types/domain';
import styles from '@/components/purchases/Purchase.module.css';

interface Line {
  product_id: string;
  name: string;
  priceCents: number;
  quantity: string;
  cost: string;
}

const INVOICE_TYPES: Array<{ value: InvoiceType; label: string }> = [
  { value: 'A', label: 'Factura A' },
  { value: 'B', label: 'Factura B' },
  { value: 'C', label: 'Factura C' },
  { value: 'X', label: 'Comprobante X' },
  { value: 'remito', label: 'Remito' },
];

const lineTotal = (l: Line) => Math.round((parseQuantity(l.quantity) ?? 0) * (parseMoney(l.cost) ?? 0));

export function PurchaseEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const store = useCurrentStore();
  const { user } = useAuth();
  const toast = useToast();
  const suppliers = useLiveQuery(listSuppliers, [], []);
  const fileInput = useRef<HTMLInputElement>(null);

  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [loaded, setLoaded] = useState(!id);
  const [supplierId, setSupplierId] = useState('');
  const [invoiceType, setInvoiceType] = useState<InvoiceType | ''>('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [file, setFile] = useState<Blob | null>(null);
  const [fileChanged, setFileChanged] = useState(false);
  const [newSupplier, setNewSupplier] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileUrl = useObjectUrl(file);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    void (async () => {
      const detail = await getPurchaseDetail(id);
      if (!alive) return;
      if (detail) {
        const p = detail.purchase;
        const products = await db.products.bulkGet(detail.items.map((i) => i.product_id));
        if (!alive) return;
        setPurchase(p);
        setSupplierId(p.supplier_id ?? '');
        setInvoiceType(p.invoice_type ?? '');
        setInvoiceNumber(p.invoice_number ?? '');
        setInvoiceDate(p.invoice_date ?? '');
        setNotes(p.notes ?? '');
        setFile(detail.file);
        setLines(
          detail.items.map((item, i) => ({
            product_id: item.product_id,
            name: products[i]?.name ?? 'Producto eliminado',
            priceCents: products[i]?.price_cents ?? 0,
            quantity: String(item.quantity),
            cost: centsToInput(item.unit_cost_cents),
          })),
        );
      }
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  if (!loaded) return null;
  if (id && !purchase) return <EmptyState icon="alert" title="Compra no encontrada" />;

  const readOnly = purchase !== null && purchase.status !== 'draft';
  const total = lines.reduce((sum, l) => sum + lineTotal(l), 0);

  const updateLine = (productId: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.product_id === productId ? { ...l, ...patch } : l)));

  const save = async (receive: boolean) => {
    setSaving(true);
    setError(null);
    try {
      await savePurchase(
        {
          store_id: purchase?.store_id ?? store.id,
          supplier_id: supplierId || null,
          invoice_type: invoiceType || null,
          invoice_number: invoiceNumber,
          invoice_date: invoiceDate || null,
          notes,
          lines: lines.map((l) => ({ product_id: l.product_id, quantity: parseQuantity(l.quantity) ?? 0, unit_cost_cents: parseMoney(l.cost) ?? -1 })),
          ...(fileChanged && { invoice_file: file }),
        },
        { id, receive, userId: user?.id ?? null },
      );
      toast(receive ? 'Compra recibida: stock y costos actualizados' : 'Borrador guardado', 'success');
      navigate('/compras', { replace: true });
    } catch (e) {
      setError(e instanceof PurchaseError ? e.message : 'No se pudo guardar la compra');
      setConfirming(false);
      setSaving(false);
    }
  };

  const pickFile = async (picked: File | undefined) => {
    if (!picked) return;
    try {
      setFile(await compressImage(picked, 1600, 0.8));
      setFileChanged(true);
    } catch {
      setError('No se pudo procesar la imagen');
    }
  };

  return (
    <>
      <PageHeader
        title={!purchase ? 'Nueva compra' : readOnly ? 'Detalle de compra' : 'Editar borrador'}
        actions={<Button variant="ghost" icon="back" onClick={() => navigate('/compras')}>Volver</Button>}
      />
      <div className={styles.layout}>
        <Card title="Comprobante">
          <fieldset className={styles.fields} disabled={readOnly}>
            <Field label="Proveedor">
              {(fid) => (
                <div className={styles.supplierRow}>
                  <Select id={fid} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                    <option value="">Elegí un proveedor</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </Select>
                  {!readOnly && <Button icon="plus" aria-label="Nuevo proveedor" onClick={() => setNewSupplier(true)} />}
                </div>
              )}
            </Field>
            <Field label="Tipo">
              {(fid) => (
                <Select id={fid} value={invoiceType} onChange={(e) => setInvoiceType(e.target.value as InvoiceType | '')}>
                  <option value="">Sin comprobante</option>
                  {INVOICE_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Número">{(fid) => <Input id={fid} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} autoComplete="off" />}</Field>
            <Field label="Fecha">{(fid) => <Input id={fid} type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />}</Field>
            <Field label="Notas">{(fid) => <Input id={fid} value={notes} onChange={(e) => setNotes(e.target.value)} autoComplete="off" />}</Field>
          </fieldset>
          <div className={styles.photo}>
            {fileUrl && (
              <a href={fileUrl} target="_blank" rel="noreferrer">
                <img src={fileUrl} alt="Foto del comprobante" />
              </a>
            )}
            {!readOnly && (
              <>
                <input ref={fileInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void pickFile(e.target.files?.[0])} />
                <Button icon="image" onClick={() => fileInput.current?.click()}>{file ? 'Cambiar foto' : 'Foto de la factura'}</Button>
              </>
            )}
          </div>
        </Card>

        <Card title="Productos">
          {!readOnly && (
            <ProductPicker
              onPick={(p) => {
                if (lines.some((l) => l.product_id === p.id)) return toast(`${p.name} ya está en la compra`, 'info');
                setLines((ls) => [...ls, { product_id: p.id, name: p.name, priceCents: p.price_cents, quantity: '', cost: p.cost_cents ? centsToInput(p.cost_cents) : '' }]);
              }}
            />
          )}
          {lines.length === 0 ? (
            <p className={`muted ${styles.empty}`}>Buscá o escaneá los productos que llegaron.</p>
          ) : (
            <ul className={styles.lines}>
              {lines.map((l) => {
                const cost = parseMoney(l.cost);
                const belowCost = cost !== null && l.priceCents > 0 && cost >= l.priceCents;
                return (
                  <li key={l.product_id}>
                    <div className={styles.lineHead}>
                      <strong>{l.name}</strong>
                      {!readOnly && <Button size="sm" variant="ghost" icon="close" aria-label={`Quitar ${l.name}`} onClick={() => setLines((ls) => ls.filter((x) => x.product_id !== l.product_id))} />}
                    </div>
                    <div className={styles.lineFields}>
                      <Input aria-label={`Cantidad de ${l.name}`} placeholder="Cantidad" inputMode="decimal" value={l.quantity} disabled={readOnly} onChange={(e) => updateLine(l.product_id, { quantity: e.target.value })} autoComplete="off" />
                      <Input aria-label={`Costo de ${l.name}`} placeholder="Costo" prefix="$" inputMode="decimal" value={l.cost} disabled={readOnly} invalid={belowCost} onChange={(e) => updateLine(l.product_id, { cost: e.target.value })} autoComplete="off" />
                      <span className={`num ${styles.lineTotal}`}>{formatMoney(lineTotal(l))}</span>
                    </div>
                    {belowCost && !readOnly && <p className={styles.warning}>El costo supera el precio de venta ({formatMoney(l.priceCents)}). Revisá el precio del producto.</p>}
                  </li>
                );
              })}
            </ul>
          )}
          <div className={`${styles.total} num`}>
            <span>Total</span>
            <strong>{formatMoney(total)}</strong>
          </div>
        </Card>

        {error && <p className={styles.error} role="alert">{error}</p>}

        {!readOnly && (
          <div className={styles.actions}>
            {purchase && (
              <Button
                variant="danger"
                disabled={saving}
                onClick={() => void cancelPurchase(purchase.id).then(() => navigate('/compras', { replace: true }))}
              >
                Cancelar borrador
              </Button>
            )}
            <Button disabled={saving} onClick={() => void save(false)}>Guardar borrador</Button>
            {confirming ? (
              <Button variant="primary" disabled={saving} onClick={() => void save(true)}>
                Confirmar: suma stock y actualiza costos
              </Button>
            ) : (
              <Button variant="primary" disabled={saving} onClick={() => setConfirming(true)}>Recibir mercadería</Button>
            )}
          </div>
        )}
      </div>
      {newSupplier && <SupplierModal supplier={null} onSaved={(s) => setSupplierId(s.id)} onClose={() => setNewSupplier(false)} />}
    </>
  );
}
