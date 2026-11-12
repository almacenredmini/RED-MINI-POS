import styles from './BarChart.module.css';

export interface Bar {
  key: string;
  /** Etiqueta del eje (corta). */
  label: string;
  value: number;
  /** Texto del cartel al pasar el mouse. */
  detail: string;
}

/**
 * Barras verticales de una sola serie: un solo color (el de la marca), sin leyenda porque el título
 * de la tarjeta la nombra. Cada barra muestra su valor al pasar el mouse o tocarla, y abajo
 * se puede abrir la misma información como tabla.
 */
export function BarChart({ bars, format, labelEvery = 1 }: { bars: Bar[]; format: (v: number) => string; labelEvery?: number }) {
  const max = Math.max(...bars.map((b) => b.value), 0);
  if (max === 0) return <p className="muted">Sin ventas en el período.</p>;
  return (
    <div className={styles.wrap}>
      <div className={styles.plot} role="img" aria-label="Gráfico de barras; abajo está la tabla con los valores">
        {bars.map((b) => (
          <div key={b.key} className={styles.slot} tabIndex={0}>
            <div className={styles.bar} style={{ height: `${(b.value / max) * 100}%` }} />
            <div className={styles.tip} role="tooltip">
              <strong className="num">{format(b.value)}</strong>
              <span>{b.detail}</span>
            </div>
          </div>
        ))}
      </div>
      <div className={styles.axis} aria-hidden>
        {bars.map((b, i) => (
          <span key={b.key}>{i % labelEvery === 0 ? b.label : ''}</span>
        ))}
      </div>
      <details className={styles.table}>
        <summary>Ver como tabla</summary>
        <table>
          <tbody>
            {bars
              .filter((b) => b.value > 0)
              .map((b) => (
                <tr key={b.key}>
                  <td>{b.detail}</td>
                  <td className="num">{format(b.value)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
