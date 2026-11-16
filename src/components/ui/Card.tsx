import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import styles from './Card.module.css';

export function Card({ title, action, children, className }: { title?: string; action?: ReactNode; children: ReactNode; className?: string | undefined }) {
  return (
    <section className={[styles.card, className].filter(Boolean).join(' ')}>
      {(title || action) && (
        <header className={styles.head}>
          {title && <h2>{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

interface StatProps {
  label: string;
  value: ReactNode;
  icon: IconName;
  foot?: ReactNode;
  highlight?: boolean;
}

export function StatCard({ label, value, icon, foot, highlight }: StatProps) {
  return (
    <div className={[styles.stat, highlight && styles.highlight].filter(Boolean).join(' ')}>
      <div className={styles.statTop}>
        <span className={styles.statLabel}>{label}</span>
        <Icon name={icon} size={18} />
      </div>
      {/* Los montos largos (millones) se achican un poco más para que entren enteros. */}
      <div className={[styles.statValue, 'num', typeof value === 'string' && value.length > 12 && styles.long].filter(Boolean).join(' ')} title={typeof value === 'string' ? value : undefined}>
        {value}
      </div>
      {foot && <div className={styles.statFoot}>{foot}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyIcon}>
        <Icon name={icon} size={28} />
      </div>
      <h2>{title}</h2>
      {children && <div className={styles.emptyBody}>{children}</div>}
    </div>
  );
}
