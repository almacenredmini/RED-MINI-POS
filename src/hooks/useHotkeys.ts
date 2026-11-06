import { useEffect, useRef } from 'react';

/** Devolver `false` deja pasar la tecla: por ejemplo, un - que se está escribiendo en un campo. */
type HotkeyMap = Record<string, (e: KeyboardEvent) => void | false>;

/**
 * Atajos por `event.key`. Se escucha en captura y se anula la acción del navegador,
 * porque F1 (ayuda), F10 (menú) y F12 (DevTools) tienen función propia.
 */
export function useHotkeys(map: HotkeyMap) {
  const ref = useRef(map);
  ref.current = map;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const handler = ref.current[e.key];
      if (!handler) return;
      if (e.repeat) return e.preventDefault();
      if (handler(e) !== false) e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}
