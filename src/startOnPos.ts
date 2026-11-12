/**
 * Al abrir la app, todos arrancan en Vender, sin importar dónde quedó la última vez.
 * Va antes que el router: el router lee la dirección cuando se crea.
 */
export const START_ROUTE = '#/vender';

if (window.location.hash !== START_ROUTE) {
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${START_ROUTE}`);
}
