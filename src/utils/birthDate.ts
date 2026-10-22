import { DateTime } from 'luxon';

import { isFechaCivil } from './cohortRules';
import { SCHOOL_TIMEZONE } from './schoolTimezone';

// Límites de PLAUSIBILIDAD de la fecha de nacimiento (no son una regla legal).
export const BIRTH_AGE_MIN = 15;
export const BIRTH_AGE_MAX = 100;

// Edad legal mínima para matricularse (18 según la ANT; pendiente de confirmar
// con la escuela). Está DESACTIVADA a propósito: mientras
// ENFORCE_LEGAL_MIN_AGE sea false, la edad mínima aplicada es BIRTH_AGE_MIN.
// Para activarla basta cambiar la bandera a true.
export const LEGAL_MIN_AGE = 18;
export const ENFORCE_LEGAL_MIN_AGE = false;

// Un mensaje y un `code` por caso. Una fecha futura es la única que dice
// «futura»; «hoy» tiene 0 años y cae en el caso de menor de la edad mínima.
export const BIRTH_DATE_MESSAGES = {
  invalida: 'La fecha de nacimiento no es válida.',
  futura: 'La fecha de nacimiento no puede ser futura.',
  edadMinima: `La edad mínima para registrar a un estudiante es de ${String(BIRTH_AGE_MIN)} años.`,
  edadMaxima: `La edad máxima permitida es de ${String(BIRTH_AGE_MAX)} años.`,
  edadLegal: 'El alumno debe tener al menos 18 años.',
} as const;

export const BIRTH_DATE_CODES = {
  futura: 'BIRTH_DATE_FUTURE',
  edadMinima: 'BIRTH_DATE_TOO_YOUNG',
  edadMaxima: 'BIRTH_DATE_TOO_OLD',
  edadLegal: 'BIRTH_DATE_UNDER_LEGAL_AGE',
} as const;

// Código de error por mensaje, para que `validateFields` lo devuelva junto a
// `field` (las cadenas de express-validator solo transportan el texto).
export const BIRTH_DATE_CODE_BY_MESSAGE: Readonly<Record<string, string>> = {
  [BIRTH_DATE_MESSAGES.futura]: BIRTH_DATE_CODES.futura,
  [BIRTH_DATE_MESSAGES.edadMinima]: BIRTH_DATE_CODES.edadMinima,
  [BIRTH_DATE_MESSAGES.edadMaxima]: BIRTH_DATE_CODES.edadMaxima,
  [BIRTH_DATE_MESSAGES.edadLegal]: BIRTH_DATE_CODES.edadLegal,
};

// Edad cumplida en años enteros a la fecha `today` (ambas «YYYY-MM-DD»).
export function ageOn(birth: string, today: string): number {
  return (
    Number(today.slice(0, 4)) -
    Number(birth.slice(0, 4)) -
    (today.slice(5) < birth.slice(5) ? 1 : 0)
  );
}

/**
 * Única función de validación de fecha de nacimiento del servidor. Devuelve el
 * mensaje de error en español o null si es válida. «Hoy» es el día de
 * Guayaquil, no el del reloj del navegador ni UTC.
 */
export function birthDateError(value: unknown, now: DateTime = DateTime.now()): string | null {
  if (!isFechaCivil(value)) return BIRTH_DATE_MESSAGES.invalida;
  const today = now.setZone(SCHOOL_TIMEZONE).toFormat('yyyy-MM-dd');
  if (value > today) return BIRTH_DATE_MESSAGES.futura;
  const age = ageOn(value, today);
  if (age < BIRTH_AGE_MIN) return BIRTH_DATE_MESSAGES.edadMinima; // incluye «hoy» (0 años)
  if (age > BIRTH_AGE_MAX) return BIRTH_DATE_MESSAGES.edadMaxima;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- bandera desactivada a propósito
  if (ENFORCE_LEGAL_MIN_AGE && age < LEGAL_MIN_AGE) return BIRTH_DATE_MESSAGES.edadLegal;
  return null;
}

// Para .custom() de express-validator: lanza con el mensaje si no es válida.
export function assertBirthDate(value: unknown): true {
  const message = birthDateError(value);
  if (message) throw new Error(message);
  return true;
}
