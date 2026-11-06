import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import styles from './Field.module.css';

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (id: string) => ReactNode;
  className?: string | undefined;
}

export function Field({ label, hint, error, children, className }: FieldProps) {
  const id = useId();
  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {children(id)}
      {error ? <span className={styles.error}>{error}</span> : hint && <span className={styles.hint}>{hint}</span>}
    </div>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  prefix?: string;
  suffix?: string;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ prefix, suffix, invalid, className, ...rest }, ref) {
  return (
    <div className={[styles.control, invalid && styles.invalid, className].filter(Boolean).join(' ')}>
      {prefix && <span className={styles.affix}>{prefix}</span>}
      <input ref={ref} className={styles.input} {...rest} />
      {suffix && <span className={styles.affix}>{suffix}</span>}
    </div>
  );
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={[styles.control, className].filter(Boolean).join(' ')}>
      <select className={styles.input} {...rest}>
        {children}
      </select>
    </div>
  );
}
