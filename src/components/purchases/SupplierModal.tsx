import { useState } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { saveSupplier, SupplierError } from '@/database/repositories/suppliers';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import type { Supplier } from '@/types/domain';
import styles from '@/components/inventory/Inventory.module.css';

interface Props {
  supplier: Supplier | null;
  onClose: () => void;
  onSaved?: (supplier: Supplier) => void;
}

export function SupplierModal({ supplier, onClose, onSaved }: Props) {
  const toast = useToast();
  const [name, setName] = useState(supplier?.name ?? '');
  const [taxId, setTaxId] = useState(supplier?.tax_id ?? '');
  const [phone, setPhone] = useState(supplier?.phone ?? '');
  const [email, setEmail] = useState(supplier?.email ?? '');
  const [notes, setNotes] = useState(supplier?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    try {
      const saved = await saveSupplier({ name, tax_id: taxId, phone, email, notes, active: supplier?.active ?? true }, supplier?.id);
      toast('Proveedor guardado', 'success');
      onSaved?.(saved);
      onClose();
    } catch (e) {
      setError(e instanceof SupplierError ? e.message : 'No se pudo guardar el proveedor');
    }
  };

  return (
    <Modal
      open
      title={supplier ? `Editar ${supplier.name}` : 'Nuevo proveedor'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={() => void save()}>Guardar</Button>
        </>
      }
    >
      <div className={styles.form}>
        <Field label="Nombre">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} data-autofocus autoComplete="off" />}</Field>
        <Field label="CUIT">{(id) => <Input id={id} value={taxId} onChange={(e) => setTaxId(e.target.value)} autoComplete="off" />}</Field>
        <Field label="Teléfono">{(id) => <Input id={id} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="off" />}</Field>
        <Field label="Email">{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />}</Field>
        <Field label="Notas">{(id) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} autoComplete="off" />}</Field>
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
