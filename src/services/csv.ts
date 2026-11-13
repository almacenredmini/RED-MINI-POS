/**
 * Exportación liviana para Excel: CSV con ";" y coma decimal (como lo espera Excel en español),
 * con BOM para que respete los acentos. Sin librerías.
 */
export type Cell = string | number | null;

const cell = (v: Cell): string => {
  if (v === null) return '';
  const s = typeof v === 'number' ? String(v).replace('.', ',') : v;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(header: string[], rows: Cell[][]): string {
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
}

/** Pesos con dos decimales, como número (Excel puede sumarlo). */
export const pesos = (cents: number) => Math.round(cents) / 100;

export function downloadCsv(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
