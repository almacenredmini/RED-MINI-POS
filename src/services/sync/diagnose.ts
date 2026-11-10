export interface DiagnosticStep {
  label: string;
  ok: boolean;
  detail: string;
}

async function attempt(label: string, run: () => Promise<Response>): Promise<DiagnosticStep> {
  try {
    const res = await run();
    return { label, ok: true, detail: `Respondió ${res.status}` };
  } catch (e) {
    return { label, ok: false, detail: e instanceof Error ? `${e.name}: ${e.message}` : 'Error desconocido' };
  }
}

/**
 * Tres pruebas que separan las causas posibles cuando un dispositivo no puede vincular:
 * llegar al servidor, mandar la clave en un encabezado y enviar un ingreso como lo hace la app.
 * El ingreso usa datos falsos a propósito: sólo importa que el servidor responda.
 */
export async function diagnoseConnection(url: string, anonKey: string): Promise<DiagnosticStep[]> {
  return [
    await attempt('Llegar al servidor', () => fetch(`${url}/auth/v1/health`)),
    await attempt('Enviar la clave', () => fetch(`${url}/auth/v1/health`, { headers: { apikey: anonKey } })),
    await attempt('Enviar un ingreso', () =>
      fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'prueba@redmini.invalid', password: 'prueba' }),
      }),
    ),
  ];
}
