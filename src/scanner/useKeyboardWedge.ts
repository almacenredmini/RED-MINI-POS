import { useEffect, useRef } from 'react';

interface Options {
  onScan: (code: string) => void;
  enabled?: boolean;
  /** Máximo ms entre teclas. Generoso: hay lectores lentos, y el Enter final ya evita falsos positivos. */
  maxInterval?: number;
  minLength?: number;
}

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.dataset.scanCapture !== undefined) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/**
 * Lector USB/Bluetooth en modo teclado ("keyboard wedge"): escribe el código muy rápido y envía Enter.
 * Se detecta por la velocidad entre teclas, así funciona sin foco en ningún campo.
 * Cuando el foco está en un input normal no interviene (ese input recibe el texto);
 * los inputs con `data-scan-capture` delegan explícitamente en este hook.
 */
export function useKeyboardWedge({ onScan, enabled = true, maxInterval = 120, minLength = 4 }: Options) {
  const buffer = useRef('');
  const last = useRef(0);
  const cb = useRef(onScan);
  cb.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target) || e.ctrlKey || e.altKey || e.metaKey) return;
      const now = performance.now();
      if (now - last.current > maxInterval) buffer.current = '';
      last.current = now;

      if (e.key === 'Enter') {
        if (buffer.current.length >= minLength) {
          e.preventDefault();
          cb.current(buffer.current);
        }
        buffer.current = '';
      } else if (e.key.length === 1) {
        buffer.current += e.key;
      }
    };

    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [enabled, maxInterval, minLength]);
}
