import { formatMoney } from './money';

/** Sobrante o faltante que se acepta en cada corte sin contarlo como diferencia: $1.000. */
export const CASH_TOLERANCE_CENTS = 100_000;

/** La caja cuadra si la diferencia (positiva sobra, negativa falta) no pasa la tolerancia. */
export const withinTolerance = (diff: number) => Math.abs(diff) <= CASH_TOLERANCE_CENTS;

/** "Sin diferencia", "Sobran $500" o "Faltan $2.000". */
export const diffText = (diff: number) => (diff === 0 ? 'Sin diferencia' : diff < 0 ? `Faltan ${formatMoney(-diff)}` : `Sobran ${formatMoney(diff)}`);
