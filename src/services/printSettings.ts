/**
 * Impresión por dispositivo: cada PC tiene su impresora. localStorage alcanza;
 * si se pierde, vuelve a los valores de fábrica (58 mm).
 */
export type PaperWidth = 58 | 80;

export interface PrintSettings {
  paper: PaperWidth;
  /** Título grande del ticket. */
  title: string;
  /** Líneas debajo del título: dirección, teléfono, Instagram… */
  header: string;
  /** Mensaje al pie. */
  footer: string;
}

export const DEFAULT_PRINT: PrintSettings = {
  paper: 58,
  title: 'RED MINI',
  header: '',
  footer: 'Gracias por su compra',
};

const KEY = 'redmini.print';

export function getPrintSettings(): PrintSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<PrintSettings>;
    return { ...DEFAULT_PRINT, ...saved, paper: saved.paper === 80 ? 80 : 58 };
  } catch {
    return DEFAULT_PRINT;
  }
}

export function savePrintSettings(settings: PrintSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Almacenamiento bloqueado: se usa lo de fábrica.
  }
}
