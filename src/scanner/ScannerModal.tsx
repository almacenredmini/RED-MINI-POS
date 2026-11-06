import { Modal } from '@/components/ui/Modal';
import { CameraScanner } from './CameraScanner';

interface Props {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
  title?: string;
  /** Sigue abierto para escanear varios productos seguidos. */
  continuous?: boolean;
  status?: string | null;
}

/** Por defecto, lectura única: al detectar un código lo devuelve y se cierra. */
export function ScannerModal({ open, onClose, onDetected, title = 'Escanear código', continuous = false, status }: Props) {
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <CameraScanner
        onDetected={(code) => {
          onDetected(code);
          if (!continuous) onClose();
        }}
      />
      {status && <p style={{ marginTop: 12, fontWeight: 600 }}>{status}</p>}
    </Modal>
  );
}
