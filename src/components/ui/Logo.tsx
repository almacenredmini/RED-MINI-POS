import styles from './Logo.module.css';

export function Logo() {
  return (
    <span className={styles.logo}>
      <span className={styles.accent}>RED</span> MINI pos
    </span>
  );
}
