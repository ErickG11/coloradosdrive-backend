import { DateTime } from 'luxon';

import { AppError } from './AppError';

// Calendario extendido, hora de 00 a 23 y zona explícita. PostgreSQL conserva
// hasta seis decimales de segundo; no truncar el instante al normalizarlo.
const EXPLICIT_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.(\d{1,6}))?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const INVALID_TIMESTAMP = 'scheduledAt debe ser una fecha y hora ISO 8601 válidas con Z u offset explícito (±HH:mm)';

export function normalizePracticeScheduledAt(value: unknown): string {
  const match = typeof value === 'string' ? EXPLICIT_TIMESTAMP.exec(value) : null;
  if (!match) throw new AppError(INVALID_TIMESTAMP, 400);

  const parsed = DateTime.fromISO(value as string, { setZone: true });
  const utc = parsed.toUTC();
  if (!parsed.isValid || parsed.year < 1 || utc.year < 1 || utc.year > 9999) {
    throw new AppError(INVALID_TIMESTAMP, 400);
  }

  // Luxon representa milisegundos: conservar la fracción original evita perder
  // microsegundos. El offset solo desplaza segundos enteros.
  const seconds = utc.toFormat("yyyy-MM-dd'T'HH:mm:ss");
  const fraction = (match.at(1) ?? '').padEnd(3, '0');
  return `${seconds}.${fraction}Z`;
}
