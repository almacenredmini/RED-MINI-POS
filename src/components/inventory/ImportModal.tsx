import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrentStore } from '@/contexts/DeviceContext';
import { useToast } from '@/contexts/ToastContext';
import { importProducts, previewImport, type ImportAction } from '@/database/repositories/productImport';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { formatMoney } from '@/services/money';
import { FIELD_LABELS, guessMapping, parseImportRows, readSheet, SpreadsheetError, type ImportField, type SheetMapping } from '@/services/spreadsheet';
import { SheetColumns } from './SheetColumns';
import styles from './Inventory.module.css';

const PREVIEW_ROWS = 30;
const FIELDS = Object.keys(FIELD_LABELS) as ImportField[];

export function ImportModal({ onClose }: { onClose: () => void }) {
  const store = useCurrentStore();
  const { user } = useAuth();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [matrix, setMatrix] = useState<unknown[][] | null>(null);
  const [mapping, setMapping] = useState<SheetMapping>({ headerIndex: 0, columns: {} });
  const [actions, setActions] = useState<Map<number, ImportAction>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const missing = FIELDS.filter((f) => (f === 'name' || f === 'price') && mapping.columns[f] === undefined);
  const ready = matrix !== null && missing.length === 0;
  const rows = useMemo(() => (ready ? parseImportRows(matrix, mapping) : []), [ready, matrix, mapping]);

  useEffect(() => {
    let alive = true;
    void previewImport(rows).then((a) => alive && setActions(a));
    return () => {
      alive = false;
    };
  }, [rows]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setMatrix(null);
    setFileName(file.name);
    try {
      const sheet = await readSheet(file);
      setMapping(guessMapping(sheet));
      setMatrix(sheet);
    } catch (e) {
      setError(e instanceof SpreadsheetError ? e.message : 'No se pudo leer el archivo');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const r = await importProducts(rows, store.id, user?.id ?? null);
      toast(`Importados: ${r.created} nuevos y ${r.updated} actualizados`, 'success');
      onClose();
    } catch {
      setError('No se pudo importar. No se guardó ningún cambio.');
      setBusy(false);
    }
  };

  const invalid = rows.filter((r) => r.errors.length > 0);
  const validRows = rows.filter((r) => r.errors.length === 0);
  const toCreate = [...actions.values()].filter((a) => a === 'create').length;
  const toUpdate = actions.size - toCreate;

  return (
    <Modal
      open
      title="Importar productos"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={busy || validRows.length === 0} onClick={() => void confirm()}>
            {busy ? 'Procesando…' : `Importar ${validRows.length || ''}`}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <p className="muted">
          Elegí un Excel o CSV y decinos qué es cada columna. La cantidad pasa a ser el stock de <strong>{store.name}</strong>.
        </p>
        <input ref={input} type="file" hidden accept=".xlsx,.xls,.csv" onChange={(e) => void onFile(e.target.files?.[0])} />
        <Button icon="purchases" disabled={busy} onClick={() => input.current?.click()}>
          {fileName ?? 'Elegir archivo'}
        </Button>
        {error && <p className={styles.error} role="alert">{error}</p>}

        {matrix && (
          <>
            <SheetColumns matrix={matrix} mapping={mapping} setMapping={setMapping} fields={FIELDS} />

            {missing.length > 0 && <p className={styles.error}>Falta elegir: {missing.map((f) => FIELD_LABELS[f]).join(' y ')}.</p>}
          </>
        )}

        {ready && (
          <>
            <div className={styles.badges}>
              <Badge tone="success">{toCreate} nuevos</Badge>
              <Badge tone="accent">{toUpdate} a actualizar</Badge>
              <Badge tone={invalid.length ? 'danger' : 'neutral'}>{invalid.length} con error</Badge>
            </div>

            {invalid.length > 0 && (
              <div className={styles.errorsBox}>
                <strong>Estas filas no se van a importar:</strong>
                <ul>
                  {invalid.slice(0, PREVIEW_ROWS).map((r) => (
                    <li key={r.row}>
                      Fila {r.row}: {r.errors.join(', ')}
                    </li>
                  ))}
                  {invalid.length > PREVIEW_ROWS && <li>… y {invalid.length - PREVIEW_ROWS} más</li>}
                </ul>
              </div>
            )}

            <ul className={styles.previewList}>
              {validRows.slice(0, PREVIEW_ROWS).map((r) => (
                <li key={r.row}>
                  <span className={styles.previewName}>
                    <strong>{r.name}</strong>
                    <span className="muted num">
                      {r.code ?? 'Sin código'} · {r.category ?? 'Sin categoría'} · Stock {r.quantity ?? 'sin cambios'} · Costo {r.cost_cents === null ? 'sin cambios' : formatMoney(r.cost_cents)}
                    </span>
                  </span>
                  <span className="num">{formatMoney(r.price_cents)}</span>
                  <Badge tone={actions.get(r.row) === 'create' ? 'success' : 'accent'}>{actions.get(r.row) === 'create' ? 'Nuevo' : 'Actualiza'}</Badge>
                </li>
              ))}
            </ul>
            {validRows.length > PREVIEW_ROWS && <p className="muted">Se muestran las primeras {PREVIEW_ROWS} de {validRows.length} filas.</p>}
          </>
        )}
      </div>
    </Modal>
  );
}
