import { domainToASCII } from 'node:url';
import { DISPOSABLE_EMAIL_DOMAINS } from '../config/disposableEmailDomains';
import { AppError } from './AppError';

// Espacios antes de quitar controles: salto de línea/tab separan palabras.
export function sanitizeEnrollmentText(value: string): string {
  return value
    .replace(/\s+/gu, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .normalize('NFC')
    .trim()
    .replace(/ +/g, ' ');
}
export function isDisposableEmailDomain(domain: string): boolean {
  const normalized = domainToASCII(domain.toLowerCase());
  return DISPOSABLE_EMAIL_DOMAINS.some(
    (blocked) => normalized === blocked || normalized.endsWith(`.${blocked}`),
  );
}
export function normalizeEnrollmentEmail(value: unknown): {
  correo: string;
  correoNormalizado: string;
} {
  const invalid = (): never => {
    throw new AppError('Ingresa un correo electrónico válido de hasta 254 caracteres.', 400, {
      code: 'CORREO_INVALIDO',
      field: 'correo',
    });
  };
  if (typeof value !== 'string' || value.length > 1024) invalid();
  const cleaned = sanitizeEnrollmentText(value as string).toLowerCase();
  const parts = cleaned.split('@');
  if (parts.length !== 2) invalid();
  const [local, rawDomain] = parts;
  const domain = domainToASCII(rawDomain);
  if (
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}$/.test(local) ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..') ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
      domain,
    )
  )
    invalid();
  const correo = `${local}@${domain}`;
  if (correo.length > 254) invalid();
  if (isDisposableEmailDomain(domain))
    throw new AppError(
      'Usa un correo personal que puedas conservar para consultar tu inscripción.',
      400,
      { code: 'CORREO_NO_ADMITIDO', field: 'correo' },
    );
  const correoNormalizado = ['gmail.com', 'googlemail.com'].includes(domain)
    ? `${local.split('+')[0].replace(/\./g, '')}@gmail.com`
    : correo;
  if (correoNormalizado.startsWith('@')) invalid();
  return { correo, correoNormalizado };
}

export function requireKnownFields(
  value: unknown,
  allowed: readonly string[],
  field = 'cuerpo',
): asserts value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)
  )
    throw new AppError('El cuerpo debe ser un objeto JSON.', 400, {
      code: 'CUERPO_INVALIDO',
      field,
    });
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string' || !allowed.includes(key)))
    throw new AppError('La petición contiene campos no permitidos.', 400, {
      code: 'CAMPO_NO_PERMITIDO',
      field,
    });
}
