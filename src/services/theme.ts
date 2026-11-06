export type Theme = 'dark' | 'light';
const KEY = 'redmini.theme';

/** Preferencia visual por dispositivo: localStorage alcanza (si se pierde, vuelve al oscuro). */
export function getTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#fafaf9' : '#0a0a0a');
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Almacenamiento bloqueado: el tema se aplica igual en esta sesión.
  }
}
