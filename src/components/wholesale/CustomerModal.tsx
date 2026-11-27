import { useState } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { deleteCustomer, saveCustomer, WholesaleError } from '@/database/repositories/wholesale';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import type { WholesaleCustomer } from '@/types/domain';
import styles from '@/components/inventory/Inventory.module.css';

interface Props {
  customer: WholesaleCustomer | null;
  onClose: () => void;
  onSaved?: (customer: WholesaleCustomer) => void;
}

export function CustomerModal({ customer, onClose, onSaved }: Props) {
  const toast = useToast();
  const [name, setName] = useState(customer?.name ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [taxId, setTaxId] = useState(customer?.tax_id ?? '');
  const [address, setAddress] = useState(customer?.address ?? '');
  const [notes, setNotes] = useState(customer?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = async () => {
    try {
      const saved = await saveCustomer({ name, phone, tax_id: taxId, address, notes }, customer?.id);
      toast('Cliente guardado', 'success');
      onSaved?.(saved);
      onClose();
    } catch (e) {
      setError(e instanceof WholesaleError ? e.message : 'No se pudo guardar el cliente');
    }
  };

  return (
    <Modal
      open
      title={customer ? `Editar ${customer.name}` : 'Nuevo cliente mayorista'}
      onClose={onClose}
      footer={
        <>
          {customer &&
            (confirmDelete ? (
              <Button variant="danger" onClick={() => void deleteCustomer(customer.id).then(onClose)}>Sí, borrarlo</Button>
            ) : (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>Borrar</Button>
            ))}
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={() => void save()}>Guardar</Button>
        </>
      }
    >
      <div className={styles.form}>
        <Field label="Nombre">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} data-autofocus autoComplete="off" />}</Field>
        <Field label="Teléfono">{(id) => <Input id={id} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="off" />}</Field>
        <Field label="CUIT">{(id) => <Input id={id} value={taxId} onChange={(e) => setTaxId(e.target.value)} autoComplete="off" />}</Field>
        <Field label="Dirección">{(id) => <Input id={id} value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="off" />}</Field>
        <Field label="Notas">{(id) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} autoComplete="off" />}</Field>
        {confirmDelete && <p className="muted">Sus tickets quedan guardados con su nombre.</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
