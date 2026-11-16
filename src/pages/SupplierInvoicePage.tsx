import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrentStore } from '@/contexts/DeviceContext';
import { useToast } from '@/contexts/ToastContext';
import { db } from '@/database/db';
import { listSuppliers } from '@/database/repositories/suppliers';
import { deleteInvoice, findSupplier, InvoiceError, parsePastedInvoice, saveInvoice, type InvoiceDraft } from '@/database/repositories/supplierInvoices';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { centsToInput, formatMoney, parseMoney } from '@/services/money';
import type { SupplierInvoice } from '@/types/domain';
import purchase from '@/components/purchases/Purchase.module.css';
import styles from './SupplierInvoicePage.module.css';

interface Line {
  key: number;
  name: string;
  quantity: string;
  price: string;
}

let nextKey = 1;
const num = (s: string) => {
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};
const lineTotal = (l: Line) => Math.round((num(l.quantity) || 0) * (parseMoney(l.price) ?? 0));
const emptyLine = (): Line => ({ key: nextKey++, name: '', quantity: '1', price: '' });

export function SupplierInvoicePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const store = useCurrentStore();
  const { user } = useAuth();
  const toast = useToast();
  const suppliers = useLiveQuery(listSuppliers, [], []);

  const [invoice, setInvoice] = useState<SupplierInvoice | null>(null);
  const [loaded, setLoaded] = useState(!id);
  const [step, setStep] = useState<'paste' | 'form'>(id ? 'form' : 'paste');
  const [pasted, setPasted] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [issuedOn, setIssuedOn] = useState('');
  const [number, setNumber] = useState('');
  const [total, setTotal] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const fill = (d: InvoiceDraft) => {
    setSupplierName(d.supplier_name);
    setIssuedOn(d.issued_on ?? '');
    setNumber(d.number ?? '');
    setTotal(d.total_cents !== null ? centsToInput(d.total_cents) : '');
    setLines(d.items.map((it) => ({ key: nextKey++, name: it.name, quantity: String(it.quantity), price: it.unit_cents ? centsToInput(it.unit_cents) : '' })));
  };

  useEffect(() => {
    if (!id) return;
    void db.supplier_invoices.get(id).then((inv) => {
      if (inv && !inv.deleted_at) {
        setInvoice(inv);
        fill(inv);
      }
      setLoaded(true);
    });
  }, [id]);

  const readPasted = (text: string) => {
    try {
      const draft = parsePastedInvoice(text);
      fill({ ...draft, supplier_name: findSupplier(suppliers, draft.supplier_name)?.name ?? draft.supplier_name });
      setStep('form');
      setError(null);
    } catch (e) {
      setError(e instanceof InvoiceError ? e.message : 'No se pudo leer lo que pegaste');
    }
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setPasted(text);
      readPasted(text);
    } catch {
      setError('El navegador no dejó leer el portapapeles. Mantené apretado el recuadro y elegí "Pegar".');
    }
  };

  if (!loaded) return null;
  if (id && !invoice) return <EmptyState icon="alert" title="Boleta no encontrada" />;

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const sum = lines.reduce((s, l) => s + lineTotal(l), 0);
  const printed = parseMoney(total);
  const back = () => navigate('/compras?tab=boletas');

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveInvoice(
        {
          store_id: invoice?.store_id ?? store.id,
          supplier_id: findSupplier(suppliers, supplierName)?.id ?? null,
          supplier_name: supplierName,
          issued_on: issuedOn || null,
          number,
          total_cents: printed,
          user_id: user?.id ?? null,
          items: lines.map((l) => ({ name: l.name, quantity: num(l.quantity), unit_cents: parseMoney(l.price) ?? 0 })),
        },
        invoice?.id,
      );
      toast('Boleta guardada', 'success');
      back();
    } catch (e) {
      setError(e instanceof InvoiceError ? e.message : 'No se pudo guardar la boleta');
      setSaving(false);
    }
  };

  if (step === 'paste') {
    return (
      <>
        <PageHeader title="Nueva boleta" actions={<Button variant="ghost" icon="back" onClick={back}>Volver</Button>} />
        <div className={purchase.layout}>
          <Card title="Pegar desde el artefacto">
            <div className={styles.paste}>
              <ol className={styles.steps}>
                <li>En el artefacto <strong>Precios de proveedores</strong>, sacá la foto y tocá <strong>Leer boleta</strong>.</li>
                <li>Tocá <strong>Copiar para RED MINI</strong>.</li>
                <li>Volvé acá y tocá <strong>Pegar boleta</strong>.</li>
              </ol>
              <div>
                <Button variant="primary" icon="purchases" onClick={() => void pasteFromClipboard()}>
                  Pegar boleta
                </Button>
              </div>
              <Field label="O pegala en este recuadro">
                {(fid) => (
                  <textarea
                    id={fid}
                    className={styles.textarea}
                    rows={4}
                    value={pasted}
                    onChange={(e) => {
                      setPasted(e.target.value);
                      if (e.target.value.trim().endsWith('}')) readPasted(e.target.value);
                    }}
                    placeholder="Mantené apretado y elegí Pegar"
                  />
                )}
              </Field>
              {pasted.trim() && (
                <div>
                  <Button onClick={() => readPasted(pasted)}>Leer lo pegado</Button>
                </div>
              )}
              {error && <p className={purchase.error} role="alert">{error}</p>}
              <p className="muted">La foto no se guarda en el sistema: sólo los datos de la boleta.</p>
            </div>
          </Card>
          <div className={purchase.actions}>
            <Button
              onClick={() => {
                setLines([emptyLine()]);
                setIssuedOn(new Date().toISOString().slice(0, 10));
                setStep('form');
                setError(null);
              }}
            >
              Cargar a mano
            </Button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={invoice ? 'Boleta' : 'Revisar boleta'} actions={<Button variant="ghost" icon="back" onClick={back}>Volver</Button>} />
      <div className={purchase.layout}>
        <p className={styles.info}>Es sólo un registro para control: no cambia el stock, los costos ni los productos.</p>
        <Card title="Comprobante">
          <div className={purchase.fields}>
            <Field label="Proveedor">
              {(fid) => (
                <>
                  <Input id={fid} list="invoice-suppliers" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} autoComplete="off" />
                  <datalist id="invoice-suppliers">
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.name} />
                    ))}
                  </datalist>
                </>
              )}
            </Field>
            <Field label="Fecha">{(fid) => <Input id={fid} type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />}</Field>
            <Field label="Comprobante">{(fid) => <Input id={fid} value={number} onChange={(e) => setNumber(e.target.value)} autoComplete="off" />}</Field>
            <Field label="Total impreso">{(fid) => <Input id={fid} prefix="$" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} autoComplete="off" />}</Field>
          </div>
        </Card>

        <Card title="Artículos">
          <ul className={purchase.lines}>
            {lines.map((l) => (
              <li key={l.key}>
                <div className={purchase.lineHead}>
                  <Input className={styles.name} aria-label="Artículo" value={l.name} placeholder="Artículo como figura en la boleta" onChange={(e) => update(l.key, { name: e.target.value })} autoComplete="off" />
                  <Button size="sm" variant="ghost" icon="close" aria-label={`Quitar ${l.name}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} />
                </div>
                <div className={styles.lineFields}>
                  <Field label="Cantidad">{(fid) => <Input id={fid} inputMode="decimal" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} autoComplete="off" />}</Field>
                  <Field label="Precio unitario">{(fid) => <Input id={fid} prefix="$" inputMode="decimal" value={l.price} onChange={(e) => update(l.key, { price: e.target.value })} autoComplete="off" />}</Field>
                  <span className={`num ${styles.lineTotal}`}>{formatMoney(lineTotal(l))}</span>
                </div>
              </li>
            ))}
          </ul>
          <Button size="sm" icon="plus" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
            Agregar artículo
          </Button>
          <div className={`${purchase.total} num`}>
            <span>Suma de líneas</span>
            <strong>{formatMoney(sum)}</strong>
          </div>
          {printed !== null &&
            (Math.abs(printed - sum) < 50 ? (
              <p className={styles.ok}>Coincide con el total de la boleta.</p>
            ) : (
              <p className={purchase.warning}>No coincide con el total impreso ({formatMoney(printed)}): diferencia de {formatMoney(Math.abs(printed - sum))}. Revisá cantidades y precios.</p>
            ))}
        </Card>

        {error && <p className={purchase.error} role="alert">{error}</p>}

        <div className={purchase.actions}>
          {invoice &&
            (confirmDelete ? (
              <Button variant="danger" disabled={saving} onClick={() => void deleteInvoice(invoice.id).then(back)}>
                Sí, borrar la boleta
              </Button>
            ) : (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>Borrar</Button>
            ))}
          <Button variant="primary" disabled={saving} onClick={() => void save()}>
            Guardar boleta
          </Button>
        </div>
      </div>
    </>
  );
}
