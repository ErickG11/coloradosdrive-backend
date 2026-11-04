// Registro seguro: un error del proveedor (SMTP, Supabase, body-parser) puede
// traer destinatarios, cuerpos de petición, cédulas o tokens. Solo se registran
// el evento, el tipo de error y códigos técnicos; jamás el mensaje original.

export interface SafeErrorSummary {
  name: string;
  code?: string;
  status?: number;
}

export function summarizeError(error: unknown): SafeErrorSummary {
  if (!error || typeof error !== 'object') return { name: typeof error };
  const record = error as { name?: unknown; code?: unknown; status?: unknown; statusCode?: unknown };
  const status = [record.status, record.statusCode].find((value) => typeof value === 'number');
  return {
    name: typeof record.name === 'string' ? record.name : 'Error',
    ...(typeof record.code === 'string' && /^[A-Za-z0-9_.-]{1,40}$/.test(record.code)
      ? { code: record.code }
      : {}),
    ...(typeof status === 'number' ? { status } : {}),
  };
}

export function logSafeError(event: string, error?: unknown): void {
  console.error(JSON.stringify({ event, ...(error === undefined ? {} : summarizeError(error)) }));
}

// Máscaras para los pocos casos en que un identificador deba aparecer en un log.
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return domain ? `${local.slice(0, 1)}***@${domain}` : '***';
}

export function maskCedula(cedula: string): string {
  return cedula.length > 4 ? `${'*'.repeat(cedula.length - 4)}${cedula.slice(-4)}` : '****';
}
