import { parseMoney } from './money';
import { normalize } from './search';
import type { Cents } from '@/types/domain';

export interface ImportRow {
  /** Número de fila en el archivo, para que el usuario pueda encontrarla. */
  row: number;
  name: string;
  code: string | null;
  /** null = la celda estaba vacía: no se toca el stock. */
  quantity: number | null;
  /** null = la celda estaba vacía: un producto existente conserva su costo. */
  cost_cents: Cents | null;
  price_cents: Cents;
  /** null = la celda estaba vacía: un producto existente conserva su categoría. */
  category: string | null;
  errors: string[];
}

export class SpreadsheetError extends Error {}

export type ImportField = 'name' | 'code' | 'category' | 'quantity' | 'cost' | 'price';

export const FIELD_LABELS: Record<ImportField, string> = {
  name: 'Nombre',
  code: 'Código de barra',
  category: 'Categoría',
  quantity: 'Cantidad',
  cost: 'Precio costo',
  price: 'Precio de venta',
};

export interface SheetMapping {
  /** Fila de títulos (desde 0); -1 si el archivo no tiene. */
  headerIndex: number;
  columns: Partial<Record<ImportField, number>>;
}

type Column = ImportField;

/** 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** Una columna tiene un solo significado y cada dato sale de una sola columna. */
export function assignColumn(columns: SheetMapping['columns'], column: number, field: ImportField | null): SheetMapping['columns'] {
  const next = { ...columns };
  for (const f of Object.keys(next) as ImportField[]) {
    if (next[f] === column) delete next[f];
  }
  if (field) next[field] = column;
  return next;
}

const HEADERS: Record<Column, string[]> = {
  name: ['nombre', 'descripcion', 'descripcion del producto', 'producto'],
  code: ['codigo de barra', 'codigo de barras', 'codigo', 'cod barras'],
  category: ['categoria', 'departamento', 'rubro', 'familia'],
  quantity: ['cantidad', 'existencia', 'stock'],
  cost: ['precio costo', 'precio de costo', 'costo'],
  price: ['precio de venta', 'precio venta', 'venta', 'precio'],
};

/** Las columnas se reconocen por título, sin importar orden, mayúsculas ni acentos. */
function findColumns(cells: unknown[]): Map<Column, number> {
  const found = new Map<Column, number>();
  cells.forEach((cell, index) => {
    const title = normalize(String(cell ?? ''));
    for (const column of Object.keys(HEADERS) as Column[]) {
      if (!found.has(column) && HEADERS[column].includes(title)) found.set(column, index);
    }
  });
  return found;
}

/** Punto de partida para el usuario: busca los títulos conocidos en las primeras filas. */
export function guessMapping(matrix: unknown[][]): SheetMapping {
  let best: SheetMapping = { headerIndex: 0, columns: {} };
  matrix.slice(0, 15).forEach((cells, headerIndex) => {
    const found = findColumns(cells);
    if (found.size > Object.keys(best.columns).length) best = { headerIndex, columns: Object.fromEntries(found) };
  });
  return best;
}

function moneyCell(value: unknown): Cents | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Math.round(value * 100);
  return /[a-z]/i.test(String(value)) ? null : parseMoney(String(value));
}

function quantityCell(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  // Mismo formato que los precios: "1.000" son mil y "1,5" es uno y medio.
  const parsed = parseMoney(String(value));
  return parsed === null || !/\d/.test(String(value)) || /[a-z]/i.test(String(value)) ? undefined : parsed / 100;
}

/** Valida fila por fila: un error no frena el archivo, sólo deja afuera esa fila y la informa. */
export function parseImportRows(matrix: unknown[][], mapping: SheetMapping = guessMapping(matrix)): ImportRow[] {
  const { headerIndex, columns } = mapping;
  if (columns.name === undefined || columns.price === undefined) {
    throw new SpreadsheetError('Falta indicar las columnas de Nombre y Precio de venta.');
  }
  const cell = (cells: unknown[], column: Column) => {
    const index = columns[column];
    return index === undefined ? undefined : cells[index];
  };

  const seenCodes = new Set<string>();
  const seenNames = new Set<string>();
  const rows: ImportRow[] = [];

  matrix.slice(headerIndex + 1).forEach((cells, i) => {
    if (cells.every((c) => c === null || c === undefined || String(c).trim() === '')) return;
    const errors: string[] = [];

    const name = String(cell(cells, 'name') ?? '').trim();
    if (!name) errors.push('Falta el nombre');

    const rawCode = cell(cells, 'code');
    const code = rawCode === null || rawCode === undefined ? '' : String(rawCode).trim();
    if (code) {
      if (seenCodes.has(code)) errors.push(`El código ${code} está repetido en el archivo`);
      seenCodes.add(code);
    } else if (name) {
      // Sin código, lo único que identifica al producto es el nombre.
      const key = normalize(name);
      if (seenNames.has(key)) errors.push('Nombre repetido y sin código de barras');
      seenNames.add(key);
    }

    const price = moneyCell(cell(cells, 'price'));
    if (price === null || price <= 0) errors.push('Precio de venta inválido');

    const rawCost = cell(cells, 'cost');
    const cost = moneyCell(rawCost);
    if (rawCost !== null && rawCost !== undefined && rawCost !== '' && (cost === null || cost < 0)) errors.push('Precio de costo inválido');

    const quantity = quantityCell(cell(cells, 'quantity'));
    if (quantity === undefined) errors.push('Cantidad inválida');

    rows.push({
      row: headerIndex + i + 2,
      name,
      code: code || null,
      quantity: quantity ?? null,
      cost_cents: cost,
      price_cents: price ?? 0,
      category: String(cell(cells, 'category') ?? '').trim() || null,
      errors,
    });
  });
  return rows;
}

/** La librería de Excel es pesada: se carga recién cuando alguien importa un archivo. */
export async function readSheet(file: Blob): Promise<unknown[][]> {
  const XLSX = await import('xlsx');
  const data = new Uint8Array(await file.arrayBuffer());
  let book;
  try {
    // raw: en un CSV, los códigos quedan como texto y no pierden los ceros de adelante.
    book = XLSX.read(data, { type: 'array', raw: true });
  } catch {
    throw new SpreadsheetError('No se pudo leer el archivo. Probá guardarlo como .xlsx o .csv.');
  }
  const first = book.SheetNames[0];
  const sheet = first ? book.Sheets[first] : undefined;
  if (!sheet) throw new SpreadsheetError('El archivo no tiene hojas');
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
}

export async function readSpreadsheet(file: Blob): Promise<ImportRow[]> {
  return parseImportRows(await readSheet(file));
}
