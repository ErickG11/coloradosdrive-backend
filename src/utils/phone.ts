// Teléfono admitido en los formularios de instructores y de matrícula manual:
// 7 a 20 caracteres (dígitos, +, espacios, guiones, paréntesis) y al menos
// 7 dígitos.
export const PHONE_MESSAGE =
  'Ingresa un teléfono válido de 7 a 20 caracteres (solo dígitos, +, espacios, guiones y paréntesis).';

export function isValidPhone(value: string): boolean {
  return /^\+?[0-9() -]{7,20}$/.test(value) && value.replace(/\D/g, '').length >= 7;
}
