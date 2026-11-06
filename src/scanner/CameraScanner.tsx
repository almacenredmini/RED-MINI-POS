import { useEffect, useRef, useState } from 'react';
import type { IScannerControls } from '@zxing/browser';
import { scanFeedback } from './feedback';
import styles from './CameraScanner.module.css';

interface Props {
  onDetected: (code: string) => void;
  /** Pausa la lectura sin apagar la cámara (p. ej. mientras se muestra un resultado). */
  paused?: boolean;
}

const REPEAT_GUARD_MS = 1500;

export function CameraScanner({ onDetected, paused = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const lastRef = useRef({ code: '', at: 0 });
  const pausedRef = useRef(paused);
  const cbRef = useRef(onDetected);
  pausedRef.current = paused;
  cbRef.current = onDetected;

  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [torch, setTorch] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Arranque diferido: en StrictMode el efecto se monta dos veces, y al detener la primera lectura
    // ZXing le quita el stream al <video> compartido, dejando a la segunda sin imagen y sin detectar nada.
    const start = setTimeout(async () => {
      if (cancelled) return;
      // Import dinámico: ZXing (~400 KB) sólo se descarga/carga cuando se abre la cámara.
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
        import('@zxing/browser'),
        import('@zxing/library'),
      ]);
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.ITF,
        BarcodeFormat.QR_CODE,
      ]);
      hints.set(DecodeHintType.TRY_HARDER, true);
      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 80 });

      try {
        const controls = await reader.decodeFromConstraints(
          {
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              // Sin enfoque continuo muchos celulares no llegan a leer barras a corta distancia.
              advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
            },
          },
          videoRef.current ?? undefined,
          (result) => {
            if (!result || pausedRef.current) return;
            const code = result.getText();
            const now = Date.now();
            const repeated = code === lastRef.current.code && now - lastRef.current.at < REPEAT_GUARD_MS;
            // Se renueva en cada lectura: el mismo código recién vuelve a contar después de salir de cuadro.
            lastRef.current = { code, at: now };
            if (repeated) return;
            scanFeedback(true);
            cbRef.current(code);
          },
        );
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
        setScanning(true);
        if (controls.switchTorch) setTorch(false);
      } catch (e) {
        if (!cancelled) setError(cameraErrorMessage(e));
      }
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(start);
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, []);

  const toggleTorch = async () => {
    const next = !torch;
    await controlsRef.current?.switchTorch?.(next);
    setTorch(next);
  };

  return (
    <div className={styles.wrap}>
      <video ref={videoRef} className={styles.video} muted playsInline />
      <div className={styles.frame} aria-hidden />
      {error ? <p className={styles.error}>{error}</p> : <p className={styles.status}>{scanning ? 'Buscando código…' : 'Iniciando cámara…'}</p>}
      {torch !== null && (
        <button type="button" className={styles.torch} onClick={toggleTorch} aria-pressed={torch}>
          {torch ? 'Apagar luz' : 'Linterna'}
        </button>
      )}
    </div>
  );
}

function cameraErrorMessage(e: unknown): string {
  const name = e instanceof Error ? e.name : '';
  if (name === 'NotAllowedError') return 'Permiso de cámara denegado. Habilitalo en la configuración del navegador.';
  if (name === 'NotFoundError') return 'No se encontró ninguna cámara.';
  if (!window.isSecureContext) return 'La cámara requiere HTTPS.';
  return 'No se pudo iniciar la cámara.';
}
