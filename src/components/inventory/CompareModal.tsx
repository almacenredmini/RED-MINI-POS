import { useEffect, useMemo, useRef, useState } from 'react';
import { useCurrentStore } from '@/contexts/DeviceContext';
import { compareInventory, type CompareResult, type CompareStatus } from '@/database/repositories/inventoryCompare';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { formatMoney } from '@/services/money';
import { guessMapping, parseCompareRows, readSheet, SpreadsheetError, type ImportField, type SheetMapping } from '@/services/spreadsheet';
import { SheetColumns } from './SheetColumns';
import styles from './Inventory.module.css';

const FIELDS: ImportField[] = ['code', 'name', 'quantity', 'price'];
const SHOW = 200;
const qty = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

const FILTERS: Array<{ status: CompareStatus; label: string; tone: 'danger' | 'accent' | 'success' }> = [
  { status: 'diff', label: 'Con diferencia', tone: 'accent' },
  { status: 'missing', label: 'No los tengo', tone: 'danger' },
  { status: 'ok', label: 'Iguales', tone: 'success' },
];

/** Compara un Excel contra el inventario de la sucursal. Sólo muestra: no cambia nada. */
export function CompareModal({ onClose }: { onClose: () => void }) {
  const store = useCurrentStore();
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [matrix, setMatrix] = useState<unknown[][] | null>(null);
  const [mapping, setMapping] = useState<SheetMapping>({ headerIndex: 0, columns: {} });
  const [results, setResults] = useState<CompareResult[]>([]);
  const [filter, setFilter] = useState<CompareStatus>('diff');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = matrix !== null && (mapping.columns.code !== undefined || mapping.columns.name !== undefined);
  const rows = useMemo(() => (ready ? parseCompareRows(matrix, mapping) : []), [ready, matrix, mapping]);
  const invalid = rows.filter((r) => r.errors.length > 0);

  useEffect(() => {
    let alive = true;
    void compareInventory(rows, store.id).then((r) => alive && setResults(r));
    return () => {
      alive = false;
    };
  }, [rows, store.id]);

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

  const count = (s: CompareStatus) => results.filter((r) => r.status === s).length;
  const shown = results.filter((r) => r.status === filter);

  return (
    <Modal open title="Comparar Excel con el inventario" onClose={onClose} footer={<Button onClick={onClose}>Cerrar</Button>}>
      <div className={styles.form}>
        <p className="muted">
          Elegí un Excel o CSV: te mostramos qué productos tienen otro stock (o precio) que en <strong>{store.name}</strong> y cuáles no tenés cargados. No se cambia nada.
        </p>
        <input ref={input} type="file" hidden accept=".xlsx,.xls,.csv" onChange={(e) => void onFile(e.target.files?.[0])} />
        <Button icon="purchases" disabled={busy} onClick={() => input.current?.click()}>
          {fileName ?? 'Elegir archivo'}
        </Button>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {matrix && (
          <>
            <SheetColumns matrix={matrix} mapping={mapping} setMapping={setMapping} fields={FIELDS} />
            {!ready && <p className={styles.error}>Elegí la columna de Código de barra o la de Nombre.</p>}
            {ready && mapping.columns.quantity === undefined && mapping.columns.price === undefined && (
              <p className="muted">Sin columna de Cantidad ni de Precio sólo se ve qué productos no tenés.</p>
            )}
          </>
        )}

        {ready && (
          <>
            <div className={styles.tabs} role="tablist">
              {FILTERS.map((f) => (
                <button
                  key={f.status}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.status}
                  className={`${styles.tab} ${filter === f.status ? styles.tabActive : ''}`}
                  onClick={() => setFilter(f.status)}
                >
                  {f.label} <Badge tone={f.tone}>{count(f.status)}</Badge>
                </button>
              ))}
            </div>

            {invalid.length > 0 && (
              <p className="muted">
                {invalid.length} {invalid.length === 1 ? 'fila no se pudo leer' : 'filas no se pudieron leer'} (fila {invalid.slice(0, 5).map((r) => r.row).join(', ')}
                {invalid.length > 5 ? '…' : ''}).
              </p>
            )}

            {shown.length === 0 ? (
              <p className="muted">Nada en esta lista.</p>
            ) : (
              <ul className={styles.previewList}>
                {shown.slice(0, SHOW).map((r) => (
                  <li key={r.row.row}>
                    <span className={styles.previewName}>
                      <strong>{r.product?.name ?? (r.row.name || r.row.code)}</strong>
                      <span className="muted num">
                        Fila {r.row.row} · {r.row.code ?? 'sin código'}
                        {r.matchedBy === 'name' ? ' · encontrado por nombre' : ''}
                      </span>
                      {r.status === 'diff' && r.priceDiff && r.product && (
                        <span className="muted num">
                          Precio: Excel {formatMoney(r.row.price_cents ?? 0)} · mío {formatMoney(r.product.price_cents)}
                        </span>
                      )}
                    </span>
                    {r.status === 'missing' ? (
                      <span className="num">{r.row.quantity !== null ? `Excel: ${qty(r.row.quantity)}` : ''}</span>
                    ) : (
                      <span className={`num ${styles.compareQty}`}>
                        {r.row.quantity !== null && (
                          <>
                            <span>
                              Excel {qty(r.row.quantity)} · mío {qty(r.myQuantity ?? 0)}
                            </span>
                            {r.quantityDiff !== null && r.quantityDiff !== 0 && (
                              <Badge tone={r.quantityDiff > 0 ? 'accent' : 'danger'}>
                                {r.quantityDiff > 0 ? '+' : ''}
                                {qty(r.quantityDiff)}
                              </Badge>
                            )}
                          </>
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {shown.length > SHOW && <p className="muted">Se muestran los primeros {SHOW} de {shown.length}.</p>}
          </>
        )}
      </div>
    </Modal>
  );
}
