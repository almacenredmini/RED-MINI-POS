import { useState, type FormEvent } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Logo } from '@/components/ui/Logo';
import styles from './LoginPage.module.css';

export function LoginPage() {
  const { login, insecure } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!(await login(username, password))) {
        setError('Usuario o contraseña incorrectos');
        setPassword('');
      }
    } catch {
      setError('No se pudo validar el usuario');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <form className={styles.panel} onSubmit={submit}>
        <div className={styles.brand}>
          <Logo />
        </div>
        <h1>Ingresar</h1>
        {insecure ? (
          <p className={styles.error}>Esta dirección no es segura. Abrí la app por HTTPS o desde localhost para poder ingresar.</p>
        ) : (
          <>
            <Field label="Usuario">
              {(id) => <Input id={id} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoCapitalize="none" autoComplete="username" />}
            </Field>
            <Field label="Contraseña">
              {(id) => <Input id={id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />}
            </Field>
            {error && <p className={styles.error} role="alert">{error}</p>}
            <Button type="submit" variant="primary" size="lg" block disabled={busy || !username.trim() || !password}>
              {busy ? 'Ingresando…' : 'Ingresar'}
            </Button>
          </>
        )}
      </form>
    </div>
  );
}
