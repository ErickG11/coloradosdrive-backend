import { AppError } from './AppError';

// Compatibilidad con errores previos; los nuevos casos asignan code explícitamente.
export function solicitudErrorCode(error: unknown): string {
  if (!(error instanceof AppError)) return 'ERROR_INTERNO';
  if (error.code) return error.code;
  if (error.message === 'Código inválido o vencido') return 'CODIGO_INVALIDO_O_VENCIDO';
  if (error.message.startsWith('Demasiados intentos fallidos')) return 'INTENTOS_AGOTADOS';
  if (error.statusCode === 429) return 'LIMITE_PETICIONES';
  if (error.message === 'Ya existe una solicitud aprobada para este correo') return 'CORREO_YA_APROBADO';
  if (error.statusCode === 401) return 'TOKEN_INVALIDO_O_VENCIDO';
  if (error.statusCode === 403) return 'ACCESO_DENEGADO';
  if (error.statusCode === 404) return 'NO_ENCONTRADO';
  if (error.statusCode === 413) return 'ARCHIVO_DEMASIADO_GRANDE';
  if (error.statusCode === 502) return 'SERVICIO_NO_DISPONIBLE';
  if (error.statusCode === 409) return 'CONFLICTO_SOLICITUD';
  return 'DATOS_INVALIDOS';
}

export function solicitudError(message: string, status: number, code: string): AppError {
  return new AppError(message, status, { code });
}
