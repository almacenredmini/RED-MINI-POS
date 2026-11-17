import type { Dispatch, SetStateAction } from 'react';
import { Select } from '@/components/ui/Field';
import { assignColumn, columnLetter, FIELD_LABELS, type ImportField, type SheetMapping } from '@/services/spreadsheet';
import styles from './Inventory.module.css';

const HEADER_OPTIONS = 15;

/** Fila de títulos y qué es cada columna del archivo. Lo usan importar y comparar. */
export function SheetColumns({
  matrix,
  mapping,
  setMapping,
  fields,
}: {
  matrix: unknown[][];
  mapping: SheetMapping;
  setMapping: Dispatch<SetStateAction<SheetMapping>>;
  fields: ImportField[];
}) {
  const columnCount = Math.max(0, ...matrix.map((r) => r.length));
  const header = mapping.headerIndex >= 0 ? matrix[mapping.headerIndex] : undefined;
  const samples = matrix.slice(mapping.headerIndex + 1, mapping.headerIndex + 3);
  const fieldOf = (column: number) => fields.find((f) => mapping.columns[f] === column) ?? '';

  return (
    <>
      <label className={styles.headerPick}>
        <span>Los títulos están en</span>
        <Select value={mapping.headerIndex} onChange={(e) => setMapping((m) => ({ ...m, headerIndex: Number(e.target.value) }))} aria-label="Fila de títulos">
          <option value={-1}>No tiene títulos</option>
          {matrix.slice(0, HEADER_OPTIONS).map((_, i) => (
            <option key={i} value={i}>
              Fila {i + 1}
            </option>
          ))}
        </Select>
      </label>

      <ul className={styles.columns}>
        {Array.from({ length: columnCount }, (_, column) => (
          <li key={column}>
            <span className={styles.columnInfo}>
              <strong>
                Columna {columnLetter(column)}
                {header?.[column] != null && header[column] !== '' ? ` · ${String(header[column])}` : ''}
              </strong>
              <span className="muted num">{samples.map((r) => String(r[column] ?? '—')).join(' / ') || '—'}</span>
            </span>
            <Select
              aria-label={`Qué es la columna ${columnLetter(column)}`}
              value={fieldOf(column)}
              onChange={(e) => setMapping((m) => ({ ...m, columns: assignColumn(m.columns, column, (e.target.value || null) as ImportField | null) }))}
            >
              <option value="">No usar</option>
              {fields.map((f) => (
                <option key={f} value={f}>
                  {FIELD_LABELS[f]}
                </option>
              ))}
            </Select>
          </li>
        ))}
      </ul>
    </>
  );
}
