import { useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { ScannerModal } from '@/scanner/ScannerModal';
import { useKeyboardWedge } from '@/scanner/useKeyboardWedge';
import styles from './ProductForm.module.css';

interface Props {
  id: string;
  codes: string[];
  onChange: (codes: string[]) => void;
}

/** Un producto puede tener varios códigos (unidad, versión vieja del envase, código interno). */
export function BarcodeEditor({ id, codes, onChange }: Props) {
  const [draft, setDraft] = useState('');
  const [scanning, setScanning] = useState(false);

  const add = (raw: string) => {
    const code = raw.trim();
    if (code && !codes.includes(code)) onChange([...codes, code]);
    setDraft('');
  };

  // Lector USB con el foco fuera de los campos: el código igual se carga.
  useKeyboardWedge({ onScan: add, enabled: !scanning });

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // El lector USB termina con Enter: se agrega el código sin enviar el formulario.
    if (e.key === 'Enter') {
      e.preventDefault();
      add(draft);
    }
  };

  return (
    <div className={styles.barcodes}>
      <div className={styles.inline}>
        <Input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          // Al ir a "Guardar" el campo pierde el foco: lo escrito no se puede perder por no haber apretado Enter.
          onBlur={() => add(draft)}
          placeholder="Escaneá o escribí y Enter"
          inputMode="numeric"
          autoComplete="off"
        />
        <Button icon="scan" onClick={() => setScanning(true)} aria-label="Escanear con cámara" />
        <Button icon="plus" onClick={() => add(draft)} disabled={!draft.trim()} aria-label="Agregar código" />
      </div>
      {codes.length > 0 && (
        <ul className={styles.chips}>
          {codes.map((c) => (
            <li key={c} className={`${styles.chip} num`}>
              {c}
              <button type="button" onClick={() => onChange(codes.filter((x) => x !== c))} aria-label={`Quitar ${c}`}>
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <ScannerModal open={scanning} onClose={() => setScanning(false)} onDetected={add} />
    </div>
  );
}
