import { minStockWindow, type Shortage } from '@/database/repositories/minStock';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import styles from './ShortagesModal.module.css';

const longDay = (d: Date) => d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'numeric' });

/** Todo lo que falta: lo que debería tener (lo vendido el mismo día de la semana pasada), lo que tiene y la diferencia. */
export function ShortagesModal({ items, storeName, onClose }: { items: Shortage[]; storeName: string; onClose: () => void }) {
  const { from } = minStockWindow();
  const manual = items.some((i) => !i.fromSales);

  return (
    <Modal open title={`Lo que falta en ${storeName}`} onClose={onClose} footer={<Button variant="primary" onClick={onClose} data-autofocus>Listo</Button>}>
      <p className={styles.intro}>
        <strong>Debería tener</strong> es lo que vendiste el {longDay(from)}, el mismo día de la semana pasada: lo que se espera vender hoy. Mañana se actualiza solo.
      </p>
      <div className={styles.wrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Producto</th>
              <th className="num">Debería</th>
              <th className="num">Tiene</th>
              <th className="num">Falta</th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.product.id}>
                <td className={styles.name}>
                  {s.product.name}
                  {!s.fromSales && <span className={styles.mark}> *</span>}
                </td>
                <td className="num">{s.should}</td>
                <td className={`num ${s.have <= 0 ? styles.out : ''}`}>{s.have}</td>
                <td className={`num ${styles.missing}`}>{s.missing}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {manual && <p className={styles.note}>* No se vendió ese día: usa el mínimo cargado en el producto.</p>}
    </Modal>
  );
}
