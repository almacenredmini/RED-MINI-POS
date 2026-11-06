import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { parseMoney } from '@/services/money';
import type { CartDiscount } from '@/services/cart';
import styles from './Pos.module.css';

interface Props {
  current: CartDiscount | null;
  onApply: (discount: CartDiscount | null) => void;
  onClose: () => void;
}

export function DiscountModal({ current, onApply, onClose }: Props) {
  const [type, setType] = useState<CartDiscount['type']>(current?.type ?? 'pct');
  const [text, setText] = useState('');

  const parsed = parseMoney(text);
  // parseMoney devuelve centavos: el porcentaje se vuelve a unidades.
  const value = parsed === null ? null : type === 'pct' ? parsed / 100 : parsed;
  const valid = value !== null && value > 0 && (type === 'amount' || value <= 100);

  return (
    <Modal
      open
      title="Descuento"
      onClose={onClose}
      footer={
        <>
          {current && (
            <Button
              onClick={() => {
                onApply(null);
                onClose();
              }}
            >
              Quitar
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!valid}
            onClick={() => {
              if (valid) onApply({ type, value });
              onClose();
            }}
          >
            Aplicar
          </Button>
        </>
      }
    >
      <div className={styles.discount}>
        <Field label="Tipo">
          {(id) => (
            <Select id={id} value={type} onChange={(e) => setType(e.target.value as CartDiscount['type'])}>
              <option value="pct">Porcentaje</option>
              <option value="amount">Monto fijo</option>
            </Select>
          )}
        </Field>
        <Field label={type === 'pct' ? 'Porcentaje' : 'Monto'}>
          {(id) => <Input id={id} {...(type === 'pct' ? { suffix: '%' } : { prefix: '$' })} inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" data-autofocus />}
        </Field>
      </div>
    </Modal>
  );
}
