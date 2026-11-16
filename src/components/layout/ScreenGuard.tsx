import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { flushPendingExit, logScreenExit, readPendingExit, savePendingExit } from '@/database/repositories/screenExits';
import { nowISO } from '@/services/id';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import styles from './ScreenGuard.module.css';

/** Pantalla completa de verdad, F11 o Chrome en modo kiosco (`--kiosk`). */
function isFullscreen(): boolean {
  if (document.fullscreenElement) return true;
  if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
  return window.innerWidth >= screen.width && window.innerHeight >= screen.height;
}

/** Sólo en PC: en el celular no se puede (ni hace falta) obligar la pantalla completa. */
const isDesktop = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches && window.innerWidth >= 900;

interface KeyboardLock {
  lock?: (keys: string[]) => Promise<void>;
}

/**
 * Quien no tiene `app.unlocked` trabaja en pantalla completa.
 * Si minimiza, cambia de programa o sale de pantalla completa, la venta se tapa hasta que vuelva,
 * y la salida queda registrada (quién, cuándo y cuánto tiempo) para verla en Reportes.
 */
export function ScreenGuard({ storeId }: { storeId: string }) {
  const { user, can } = useAuth();
  const locked = !!user && !can('app.unlocked') && isDesktop();
  const [inside, setInside] = useState(() => isFullscreen() && !document.hidden);
  // Hasta entrar la primera vez no es una salida: es el arranque.
  const [armed, setArmed] = useState(false);
  const leftAt = useRef<string | null>(null);
  // El usuario se vuelve a leer con cada sincronización: se usa una referencia para no cortar la salida en dos.
  const who = useRef(user);
  who.current = user;
  const userId = user?.id;

  useEffect(() => {
    void flushPendingExit();
  }, []);

  const check = useCallback(() => setInside(isFullscreen() && !document.hidden), []);

  useEffect(() => {
    if (!locked) return;
    // Un temporizador y no requestAnimationFrame: el navegador pausa los cuadros con la ventana minimizada.
    const onChange = () => setTimeout(check, 50);
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('visibilitychange', onChange);
    window.addEventListener('resize', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('visibilitychange', onChange);
      window.removeEventListener('resize', onChange);
    };
  }, [locked, check]);

  // Primera vez adentro: desde ahí, salir cuenta.
  useEffect(() => {
    if (locked && inside) setArmed(true);
  }, [locked, inside]);

  // Registro de la salida: empieza al salir y se guarda al volver.
  useEffect(() => {
    const u = who.current;
    if (!locked || !armed || !u) return;
    if (!inside && !leftAt.current) {
      leftAt.current = nowISO();
      savePendingExit({ store_id: storeId, user_id: u.id, user_name: u.name, left_at: leftAt.current, last_seen: leftAt.current });
    }
    if (inside && leftAt.current) {
      const left = leftAt.current;
      leftAt.current = null;
      savePendingExit(null);
      void logScreenExit({ store_id: storeId, user_id: u.id, user_name: u.name, left_at: left, returned_at: nowISO() });
    }
  }, [locked, armed, inside, userId, storeId]);

  // Mientras está afuera, se anota que el programa sigue abierto: si lo cierran, la salida termina ahí.
  useEffect(() => {
    if (inside || !leftAt.current) return;
    const id = setInterval(() => {
      const p = readPendingExit();
      if (p) savePendingExit({ ...p, last_seen: nowISO() });
    }, 20_000);
    return () => clearInterval(id);
  }, [inside]);

  // Al cerrar sesión estando afuera, la salida termina ahí.
  useEffect(
    () => () => {
      const u = who.current;
      if (leftAt.current && u) {
        void logScreenExit({ store_id: storeId, user_id: u.id, user_name: u.name, left_at: leftAt.current, returned_at: nowISO() });
        savePendingExit(null);
        leftAt.current = null;
      }
      setArmed(false);
    },
    [userId, storeId],
  );

  if (!locked || inside) return null;

  const enter = async () => {
    try {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      // Que Esc cierre ventanas de la app y no saque de pantalla completa (mantener Esc apretado sí sale).
      await (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard?.lock?.(['Escape']);
    } catch {
      /* el navegador no lo permitió: el bloqueo sigue a la vista */
    }
    check();
  };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="screen-guard-title">
      <div className={styles.box}>
        <Logo />
        {armed ? (
          <>
            <h2 id="screen-guard-title">Saliste de la pantalla de venta</h2>
            <p className="muted">Quedó registrado. Volvé a pantalla completa para seguir vendiendo.</p>
          </>
        ) : (
          <>
            <h2 id="screen-guard-title">La caja trabaja en pantalla completa</h2>
            <p className="muted">Si salís de la pantalla completa o cambiás de programa, queda registrado.</p>
          </>
        )}
        <Button variant="primary" size="lg" icon="pos" onClick={() => void enter()}>
          {armed ? 'Volver a pantalla completa' : 'Empezar'}
        </Button>
      </div>
    </div>
  );
}
