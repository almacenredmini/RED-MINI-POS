import { useEffect } from 'react';
import { NavLink, Outlet, type NavLinkProps } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useDevice } from '@/contexts/DeviceContext';
import { useToast } from '@/contexts/ToastContext';
import { recalcMinStockIfNewWeek } from '@/database/repositories/minStock';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Logo } from '@/components/ui/Logo';
import { LoginPage } from '@/pages/LoginPage';
import { SyncIndicator } from './SyncIndicator';
import { StorePicker } from './StorePicker';
import { StoreSwitcher } from './StoreSwitcher';
import { NAV_ITEMS } from './navigation';
import styles from './AppShell.module.css';

export function AppShell() {
  const { user, can, logout, canSwitchStore } = useAuth();
  const toast = useToast();
  const { stores, currentStore } = useDevice();
  const storeId = user ? currentStore?.id : undefined;

  useEffect(() => {
    if (storeId) recalcMinStockIfNewWeek(storeId).catch(console.error);
  }, [storeId]);

  if (!user) return <LoginPage />;
  if (user.store_id && currentStore?.id !== user.store_id) {
    // Hasta aplicar la sucursal fija no se muestra nada: una venta no puede caer en otra sucursal.
    if (stores.some((s) => s.id === user.store_id)) return <div className="boot"><Logo /></div>;
    return <EmptyState icon="alert" title="Tu sucursal no está disponible. Avisale al dueño." />;
  }
  if (!currentStore) {
    return canSwitchStore ? <StorePicker /> : <EmptyState icon="alert" title="Tu usuario no tiene sucursal asignada. Avisale al dueño." />;
  }

  // Todos ven el menú completo, como pidió el dueño; lo que no pueden usar queda marcado y avisa al tocarlo.
  const mobileItems = NAV_ITEMS.filter((i) => i.mobile);
  const lockedProps = (allowed: boolean): Partial<NavLinkProps> =>
    allowed
      ? {}
      : {
          onClick: (e) => {
            e.preventDefault();
            toast('No tenés permiso para entrar a esa pantalla', 'error');
          },
          'aria-disabled': true,
        };

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarBrand}>
          <Logo />
        </div>
        <nav className={styles.nav}>
          {NAV_ITEMS.map((item) => {
            const allowed = can(item.permission);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => `${styles.link} ${isActive && allowed ? styles.active : ''} ${allowed ? '' : styles.locked}`}
                {...lockedProps(allowed)}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
                {!allowed ? <Icon name="lock" size={14} className={styles.lockIcon} /> : item.stage && <span className={styles.stage}>E{item.stage}</span>}
              </NavLink>
            );
          })}
        </nav>
        <div className={styles.sidebarFoot}>
          <StoreSwitcher />
          <SyncIndicator />
          <div className={styles.userRow}>
            <span>{user.name}</span>
            <Button size="sm" variant="ghost" onClick={logout}>
              Salir
            </Button>
          </div>
        </div>
      </aside>

      <header className={styles.topbar}>
        <Logo />
        <div className={styles.topbarRight}>
          <StoreSwitcher />
          <SyncIndicator compact />
          <span className={styles.userName}>{user.name}</span>
          <Button size="sm" variant="ghost" onClick={logout}>
            Salir
          </Button>
        </div>
      </header>

      <main className={styles.main}>
        <Outlet />
      </main>

      <nav className={styles.bottomnav} style={{ gridTemplateColumns: `repeat(${mobileItems.length}, 1fr)` }}>
        {mobileItems.map((item) => {
          const allowed = can(item.permission);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `${styles.tab} ${item.to === '/escanear' ? styles.tabScan : ''} ${isActive && allowed ? styles.active : ''} ${allowed ? '' : styles.locked}`
              }
              {...lockedProps(allowed)}
            >
              <Icon name={item.icon} size={item.to === '/escanear' ? 24 : 22} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

    </div>
  );
}
