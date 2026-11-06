import { useRef, useState } from 'react';
import { useObjectUrl } from '@/hooks/useObjectUrl';
import { compressImage } from '@/services/image';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import styles from './ProductForm.module.css';

interface Props {
  value: Blob | null;
  onChange: (blob: Blob | null) => void;
}

export function ImagePicker({ value, onChange }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const url = useObjectUrl(value);
  const [busy, setBusy] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      onChange(await compressImage(file));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className={styles.image}>
      <button type="button" className={styles.imageBox} onClick={() => input.current?.click()} disabled={busy}>
        {url ? <img src={url} alt="Imagen del producto" /> : <Icon name="image" size={32} />}
        <span>{busy ? 'Procesando…' : url ? 'Cambiar foto' : 'Agregar foto'}</span>
      </button>
      {/* capture=environment abre directo la cámara trasera en celulares. */}
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void pick(e.target.files?.[0])} />
      {url && (
        <Button size="sm" variant="ghost" icon="trash" onClick={() => onChange(null)}>
          Quitar
        </Button>
      )}
    </div>
  );
}
