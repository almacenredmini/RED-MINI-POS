import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { parseMoney } from '@/services/money';
import styles from './Pos.module.css';

interface Props {
  onAdd: (name: string, priceCents: number) => void;
  onClose: () => void;
}

/**
 * Producto común (Ctrl+P): algo que no está en el catálogo, con descripción y monto inventados en el momento.
 * Se cobra y sale en el ticket, pero no toca el stock ni entra en los reportes.
 */
export function CommonProductModal({ onAdd, onClose }: Props) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const cents = parseMoney(price);
  const valid = cents !== null && cents > 0;

  const add = () => {
    if (!valid) return;
    onAdd(name.trim() || 'Producto común', cents);
    onClose();
  };

  return (
    <Modal
      open
      title="Producto común"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!valid} onClick={add}>
            Agregar
          </Button>
        </>
      }
    >
      <form
        className={styles.discount}
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Field label="Descripción" hint="Si la dejás vacía, sale como «Producto común».">
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" data-autofocus />}
        </Field>
        <Field label="Monto">
          {(id) => <Input id={id} prefix="$" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} autoComplete="off" />}
        </Field>
        <p className="muted">No se descuenta del stock ni se suma en los reportes. Sí entra en la caja y en el ticket.</p>
        {/* Enter en cualquier campo agrega el producto. */}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
