import { AppError } from './AppError';
import { logSafeError } from './safeLog';
const errors: Record<string, [number, string, string]> = {
  IR403: [
    403,
    'RESERVA_NO_PERMITIDA',
    'No puedes reservar con el estado actual de tu inscripción.',
  ],
  IR404: [404, 'RESERVA_NO_ENCONTRADA', 'No encontramos esa matrícula o reserva.'],
  IR409: [
    409,
    'HORARIO_NO_DISPONIBLE',
    'Una franja ya no está disponible. Consulta y elige de nuevo.',
  ],
  IR410: [
    409,
    'RESERVA_YA_EXISTE',
    'Ya tienes una reserva vigente. Revísala antes de elegir otro horario.',
  ],
  IR411: [409, 'RESERVA_NO_AMPLIABLE', 'Esta reserva ya no se puede ampliar.'],
  IR412: [
    409,
    'PAGO_EN_CURSO',
    'Hay un pago en curso. Espera su resultado antes de liberar el horario.',
  ],
  IR413: [
    409,
    'COHORT_CON_RESERVAS',
    'La cohorte tiene reservas vigentes. Conserva el curso, el precio y las fechas compatibles.',
  ],
  IR422: [
    409,
    'SIN_COHORTE_ELEGIBLE',
    'No hay una cohorte con cupo que contenga todas las fechas. Prueba un inicio posterior.',
  ],
  IR429: [
    429,
    'LIMITE_RESERVAS_DIARIO',
    'Alcanzaste el máximo de reservas de hoy. Intenta mañana.',
  ],
  CD001: [409, 'COHORTE_SIN_CUPO', 'El último cupo se ocupó. Consulta el horario nuevamente.'],
  '22023': [
    400,
    'PLAN_INVALIDO',
    'El plan de prácticas no es válido. Revisa las fechas y las horas.',
  ],
  '23P01': [409, 'HORARIO_NO_DISPONIBLE', 'Una franja se acaba de ocupar. Consulta nuevamente.'],
  '23505': [409, 'RESERVA_YA_EXISTE', 'La reserva cambió. Consulta su estado antes de reintentar.'],
  '40P01': [
    409,
    'RESERVA_CONCURRENTE',
    'El horario se está actualizando. Consulta antes de reintentar.',
  ],
  '40001': [
    409,
    'RESERVA_CONCURRENTE',
    'El horario se está actualizando. Consulta antes de reintentar.',
  ],
  '55P03': [
    409,
    'RESERVA_CONCURRENTE',
    'El horario se está actualizando. Consulta antes de reintentar.',
  ],
  '57014': [503, 'RESERVA_NO_DISPONIBLE', 'La consulta tardó demasiado. Intenta nuevamente.'],
};
export function throwStudentScheduleError(error: unknown): never {
  if (error instanceof AppError) throw error;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  const mapped = typeof code === 'string' ? errors[code] : undefined;
  if (mapped) throw new AppError(mapped[2], mapped[0], { code: mapped[1] });
  logSafeError('student_schedule_failed', error);
  throw new AppError('No pudimos consultar el horario. Intenta nuevamente.', 503, {
    code: 'RESERVA_NO_DISPONIBLE',
  });
}
