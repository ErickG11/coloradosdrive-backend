import { AppError } from './AppError';
import { logSafeError } from './safeLog';
const map: Record<string, [number, string, string]> = {
  IP403: [403, 'PAGO_NO_PERMITIDO', 'Tu inscripción no está habilitada para este pago.'],
  IP404: [404, 'PAGO_NO_ENCONTRADO', 'No encontramos ese pago o reserva.'],
  IP409: [
    409,
    'PAGO_CONFLICTO',
    'El intento o la referencia ya cambió. Consulta el estado antes de reintentar.',
  ],
  IP410: [
    409,
    'PAGO_PENDIENTE',
    'Ya existe un pago pendiente o recibido. Consulta su estado; no pagues otra vez.',
  ],
  IP411: [409, 'RESERVA_VENCIDA', 'La reserva venció. Elige tu horario nuevamente.'],
  IP422: [400, 'PAGO_MONTO_DISTINTO', 'El importe o la moneda no coincide con el pago esperado.'],
  IP423: [
    409,
    'PAYMENTS_REQUIRE_REVIEW',
    'Resuelve el historial de pagos antes de eliminar al alumno.',
  ],
  '23505': [409, 'PAGO_CONFLICTO', 'El intento o la referencia ya existe. Consulta su estado.'],
  '42501': [403, 'PAGO_NO_PERMITIDO', 'No tienes permiso para registrar este pago.'],
  '22023': [400, 'PAGO_INVALIDO', 'Los datos del intento de pago no son válidos.'],
  '40P01': [409, 'PAGO_CONCURRENTE', 'El pago se está actualizando. Consulta antes de reintentar.'],
  '55P03': [409, 'PAGO_CONCURRENTE', 'El pago se está actualizando. Consulta antes de reintentar.'],
};
export function throwStudentPaymentError(error: unknown): never {
  if (error instanceof AppError) throw error;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  const item = typeof code === 'string' ? map[code] : undefined;
  if (item) throw new AppError(item[2], item[0], { code: item[1] });
  logSafeError('student_payment_failed', error);
  throw new AppError(
    'No pudimos confirmar la respuesta. Consulta el estado del pago antes de reintentar.',
    503,
    { code: 'PAGO_NO_DISPONIBLE' },
  );
}
