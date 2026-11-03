import { AppError } from './AppError';
import { isValidCedulaEcuatoriana } from './cedula';
import { normalizeEnrollmentEmail, sanitizeEnrollmentText } from './enrollmentSanitization';

export function invalidField(field: string, message: string, code = 'CAMPO_INVALIDO'): never {
  throw new AppError(message, 400, { code, field });
}
export function normalizeName(value: unknown, field = 'nombreCompleto'): string {
  const name = typeof value === 'string' ? sanitizeEnrollmentText(value) : '';
  if (
    Array.from(name).length < 5 ||
    Array.from(name).length > 100 ||
    !/^[\p{L}\p{M}]+(?:[ '\u2019-][\p{L}\p{M}]+)*$/u.test(name) ||
    name.split(' ').length < 2
  ) {
    invalidField(
      field,
      'Ingresa nombres y apellidos: de 5 a 100 caracteres, solo letras, espacios, apóstrofe o guion.',
      'NOMBRE_INVALIDO',
    );
  }
  return name;
}
export function normalizePhone(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string')
    invalidField('telefono', 'Ingresa un teléfono ecuatoriano válido.', 'TELEFONO_INVALIDO');
  const phone = value.trim().replace(/^\+593/, '0');
  if (!/^(09\d{8}|0[2-7]\d{7})$/.test(phone))
    invalidField(
      'telefono',
      'Usa un celular de 10 dígitos (09) o convencional de 9 dígitos (02 a 07); se acepta +593.',
      'TELEFONO_INVALIDO',
    );
  return phone;
}
export function validateCedula(value: unknown, field = 'cedula'): asserts value is string {
  if (typeof value !== 'string' || !isValidCedulaEcuatoriana(value))
    invalidField(field, 'Ingresa una cédula ecuatoriana válida.', 'CEDULA_INVALIDA');
}
export function normalizeEmail(value: unknown): string {
  return normalizeEnrollmentEmail(value).correo;
}
