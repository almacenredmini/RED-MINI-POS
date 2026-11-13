import { Suspense, useEffect, useRef, useState, type MouseEvent } from 'react';
import { NavLink, Outlet, useLocation, type NavLinkProps } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useDevice } from '@/contexts/DeviceContext';
import { useToast } from '@/contexts/ToastContext';
import { recalcMinStockIfNewWeek } from '@/database/repositories/minStock';
import { EmptyState } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Logo } from '@/components/ui/Logo';
import { LoginPage } from '@/pages/LoginPage';
import { ExitButton } from './ExitButton';
import { SyncIndicator } from './SyncIndicator';
import { StorePicker } from './StorePicker';
import { StoreSwitcher } from './StoreSwitcher';
import { NAV_ITEMS, type NavItem } from './navigation';
import styles from './AppShell.module.css';

export function AppShell() {
  const { user, restoring, can, canSwitchStore } = useAuth();
  const { stores, currentStore } = useDevice();
  const toast = useToast();
  const storeId = user ? currentStore?.id : undefined;
  const moreRef = useRef<HTMLDetailsElement>(null);
  const { pathname } = useLocation();
  const [sheetOpen, setSheetOpen] = useState(false);

  // El menú "Más" del celular se cierra al cambiar de pantalla.
  useEffect(() => setSheetOpen(false), [pathname]);

  // El menú "Más" se cierra al tocar afuera.
  useEffect(() => {
    const close = (e: PointerEvent) => {
      const more = moreRef.current;
      if (more?.open && !more.contains(e.target as Node)) more.open = false;
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  useEffect(() => {
    if (storeId) recalcMinStockIfNewWeek(storeId).catch(console.error);
  }, [storeId]);

  if (!user) return restoring ? <div className="boot"><Logo /></div> : <LoginPage />;
  if (user.store_id && currentStore?.id !== user.store_id) {
    // Hasta aplicar la sucursal fija no se muestra nada: una venta no puede caer en otra sucursal.
    if (stores.some((s) => s.id === user.store_id)) return <div className="boot"><Logo /></div>;
    return <EmptyState icon="alert" title="Tu sucursal no está disponible. Avisale al dueño." />;
  }
  if (!currentStore) {
    return canSwitchStore ? <StorePicker /> : <EmptyState icon="alert" title="Tu usuario no tiene sucursal asignada. Avisale al dueño." />;
  }

  // Todos ven el menú completo; lo que no pueden usar queda marcado y avisa al tocarlo.
  const linkProps = (item: NavItem, className: (active: boolean) => string): NavLinkProps => {
    const allowed = can(item.permission);
    return {
      to: item.to,
      end: item.to === '/',
      className: ({ isActive }) => `${className(isActive && allowed)} ${allowed ? '' : styles.locked}`,
      ...(!allowed && {
        'aria-disabled': true,
        onClick: (e: MouseEvent) => {
          e.preventDefault();
          toast('No tenés permiso para entrar a esa pantalla', 'error');
        },
      }),
    };
  };

  const menuButton = (item: NavItem, extraClass = '') => (
    <NavLink key={item.to} {...linkProps(item, (active) => `${styles.menuButton} ${extraClass} ${active ? styles.active : ''}`)}>
      <Icon name={item.icon} size={18} />
      <span>{item.label}</span>
      {!can(item.permission) && <Icon name="lock" size={11} className={styles.lockBadge} />}
    </NavLink>
  );

  const mobileItems = NAV_ITEMS.filter((i) => i.mobile);
  const sheetItems = NAV_ITEMS.filter((i) => !i.mobile);
  const inSheet = sheetItems.some((i) => pathname.startsWith(i.to));

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.topbar}>
          <Logo />
          <div className={styles.topbarRight}>
            <StoreSwitcher />
            <SyncIndicator compact />
            <span className={styles.userName}>{user.name}</span>
            <ExitButton />
          </div>
        </div>

        {/* En PC: fila de botones, como en Eleventa. Las menos usadas pasan a "Más" si la pantalla es angosta. */}
        <nav className={styles.menubar} aria-label="Secciones">
          {NAV_ITEMS.map((item) => menuButton(item, item.secondary ? styles.secondaryButton : ''))}
          <details className={styles.more} ref={moreRef}>
            <summary className={`${styles.menuButton} ${NAV_ITEMS.some((i) => i.secondary && pathname.startsWith(i.to)) ? styles.active : ''}`}>
              Más
              <Icon name="back" size={14} className={styles.moreChevron} />
            </summary>
            <div className={styles.moreList} onClick={() => moreRef.current?.removeAttribute('open')}>{NAV_ITEMS.filter((i) => i.secondary).map((item) => menuButton(item))}</div>
          </details>
        </nav>
      </header>

      <main className={styles.main}>
        <Suspense fallback={<p className="muted">Cargando…</p>}>
          <Outlet />
        </Suspense>
      </main>

      {/* Celular: todo lo que no entra en la barra inferior está en "Más". */}
      {sheetOpen && (
        <div className={styles.sheetBackdrop} onClick={() => setSheetOpen(false)}>
          <nav className={styles.sheet} aria-label="Más secciones" onClick={(e) => e.stopPropagation()}>
            {sheetItems.map((item) => (
              <NavLink key={item.to} {...linkProps(item, (active) => `${styles.sheetItem} ${active ? styles.active : ''}`)}>
                <Icon name={item.icon} size={22} />
                <span>{item.label}</span>
                {!can(item.permission) && <Icon name="lock" size={11} className={styles.lockBadge} />}
              </NavLink>
            ))}
          </nav>
        </div>
      )}

      <nav className={styles.bottomnav} style={{ gridTemplateColumns: `repeat(${mobileItems.length + 1}, 1fr)` }}>
        {mobileItems.map((item) => (
          <NavLink key={item.to} {...linkProps(item, (active) => `${styles.tab} ${item.to === '/escanear' ? styles.tabScan : ''} ${active ? styles.active : ''}`)}>
            <Icon name={item.icon} size={item.to === '/escanear' ? 24 : 22} />
            <span>{item.label}</span>
          </NavLink>
        ))}
        <button type="button" className={`${styles.tab} ${styles.tabButton} ${sheetOpen || inSheet ? styles.active : ''}`} aria-expanded={sheetOpen} onClick={() => setSheetOpen((o) => !o)}>
          <Icon name="menu" size={22} />
          <span>Más</span>
        </button>
      </nav>
    </div>
  );
}
