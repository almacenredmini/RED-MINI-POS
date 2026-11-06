import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from './Icon';
import styles from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface Common {
  variant?: Variant | undefined;
  size?: Size | undefined;
  icon?: IconName | undefined;
  block?: boolean | undefined;
  children?: ReactNode;
}

function classes({ variant = 'secondary', size = 'md', block, icon, children }: Common, extra?: string) {
  return [styles.btn, styles[variant], styles[size], block && styles.block, icon && !children && styles.iconOnly, extra]
    .filter(Boolean)
    .join(' ');
}

export function Button({ variant, size, icon, block, children, className, type = 'button', ...rest }: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={classes({ variant, size, icon, block, children }, className)} {...rest}>
      {icon && <Icon name={icon} size={size === 'lg' ? 22 : 18} />}
      {children}
    </button>
  );
}

export function ButtonLink({ to, variant, size, icon, block, children }: Common & { to: string }) {
  return (
    <Link to={to} className={classes({ variant, size, icon, block, children })}>
      {icon && <Icon name={icon} size={size === 'lg' ? 22 : 18} />}
      {children}
    </Link>
  );
}
