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

export const BIRTH_DATE_MESSAGES = {
  invalida: 'La fecha de nacimiento no es válida.',
  hoyOFutura: 'La fecha de nacimiento no puede ser hoy ni una fecha futura.',
  edad: 'La edad debe estar entre 15 y 100 años.',
  edadLegal: 'El alumno debe tener al menos 18 años.',
} as const;

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
  if (value >= today) return BIRTH_DATE_MESSAGES.hoyOFutura;
  const age = ageOn(value, today);
  if (age < BIRTH_AGE_MIN || age > BIRTH_AGE_MAX) return BIRTH_DATE_MESSAGES.edad;
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
