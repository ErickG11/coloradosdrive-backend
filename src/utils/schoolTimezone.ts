import { DateTime } from 'luxon';

import { AppError } from './AppError';

// Única fuente de verdad de la zona horaria de la escuela (Ecuador: UTC-5
// fijo, sin horario de verano). Todo lo que convierta una fecha/hora "de
// pared" (lo que un admin escribe, ej. "15:00") a un instante UTC real para
// guardar en `scheduled_at` (timestamptz) pasa por aquí — así el offset
// nunca queda repetido como número mágico en varios archivos.
export const SCHOOL_TIMEZONE = 'America/Guayaquil';

const HORA_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export interface HoraDelDia {
  hour: number;
  minute: number;
}

export function parseHora(value: string): HoraDelDia {
  const match = HORA_REGEX.exec(value);
  if (!match) {
    throw new AppError(`Hora inválida: "${value}" (formato esperado HH:mm)`, 400);
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function formatHora({ hour, minute }: HoraDelDia): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Parsea una fecha "YYYY-MM-DD" como fecha civil de la escuela (sin hora),
 * para hacer aritmética de días/día-de-semana sin ambigüedad de zona
 * horaria.
 */
export function parseFechaCivil(value: string): DateTime {
  if (!FECHA_REGEX.test(value)) {
    throw new AppError(`Fecha inválida: "${value}" (formato esperado YYYY-MM-DD)`, 400);
  }
  const dt = DateTime.fromISO(value, { zone: SCHOOL_TIMEZONE });
  if (!dt.isValid) {
    throw new AppError(`Fecha inválida: "${value}"`, 400);
  }
  return dt.startOf('day');
}

/**
 * Combina una fecha civil (de parseFechaCivil) y una hora de pared en la
 * zona horaria de la escuela, y devuelve el instante UTC real como ISO
 * (lo que se guarda en scheduled_at).
 */
export function toScheduledAtUTC(fechaCivil: DateTime, hora: HoraDelDia): string {
  const local = fechaCivil.set({ hour: hora.hour, minute: hora.minute, second: 0, millisecond: 0 });
  const iso = local.isValid ? local.toUTC().toISO() : null;
  if (iso === null) {
    throw new AppError('No se pudo calcular la fecha/hora de la franja', 400);
  }
  return iso;
}
