import { AppError } from './AppError';
import { MENSAJE_DATOS_DUPLICADOS } from '../config/enrollmentCatalog';

// Compatibilidad con errores previos; los nuevos casos asignan code explícitamente.
export function solicitudErrorCode(error: unknown): string {
  if (!(error instanceof AppError)) return 'ERROR_INTERNO';
  if (error.code) return error.code;
  if (error.message.startsWith('motivoRechazo')) return 'MOTIVO_REQUERIDO';
  if (
    error.message === 'codigo debe tener 6 dígitos' ||
    error.message === 'Código inválido o vencido'
  )
    return 'CODIGO_INVALIDO_O_VENCIDO';
  if (error.message.startsWith('Demasiados intentos fallidos')) return 'INTENTOS_AGOTADOS';
  if (error.statusCode === 429) return 'LIMITE_PETICIONES';
  if (error.message === 'Ya existe una solicitud aprobada para este correo')
    return 'CORREO_YA_APROBADO';
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

export function normalizeSolicitudError(error: Error): Error {
  const sql = 'code' in error ? error.code : undefined;
  const map: Partial<Record<string, [number, string, string]>> = {
    SI404: [404, 'NO_ENCONTRADO', 'La solicitud o el documento no existe'],
    SI401: [403, 'CORREO_NO_VERIFICADO', 'Verifica tu correo'],
    SI410: [409, 'SOLICITUD_ENVIADA', 'La solicitud ya fue enviada'],
    SI411: [409, 'DOCUMENTO_YA_REVISADO', 'Este documento ya fue revisado'],
    SI412: [409, 'DOCUMENTO_YA_APROBADO', 'Este documento ya fue aprobado'],
    SI413: [409, 'SOLICITUD_NO_ENVIADA', 'La solicitud no ha sido enviada'],
    SI422: [400, 'DATOS_REQUERIDOS', 'Completa tus datos personales'],
    SI423: [
      400,
      'REPRESENTANTE_REQUERIDO',
      'Completa los datos y la autorización del representante',
    ],
    SI424: [400, 'SOLICITUD_INCOMPLETA', 'Faltan documentos obligatorios'],
    SI425: [400, 'EDAD_MINIMA', 'La edad es inferior al mínimo actual del curso.'],
    SI426: [400, 'EDAD_MAXIMA', 'La edad máxima es de 100 años cumplidos.'],
    SI427: [400, 'FECHA_INVALIDA', 'Ingresa una fecha de nacimiento real y no futura.'],
    SI428: [503, 'CURSO_NO_DISPONIBLE', 'El curso no está disponible. Contacta a la escuela.'],
    SI429: [409, 'DATOS_NO_REGISTRADOS', MENSAJE_DATOS_DUPLICADOS],
    SI435: [409, 'ESTADO_INCORRECTO', 'Esta acción no corresponde al estado actual de tu solicitud.'],
    SI433: [
      409,
      'DATOS_CAMBIARON',
      'Tus datos cambiaron mientras subías el archivo. Vuelve a intentarlo.',
    ],
    SI434: [
      400,
      'SUBTIPO_CERTIFICADO_INVALIDO',
      'Ese documento no corresponde a tu nivel de estudios.',
    ],
    SI431: [
      400,
      'NIVEL_ESTUDIOS_NO_ADMITIDO',
      'Necesitas haber aprobado al menos décimo para inscribirte.',
    ],
    SI432: [
      400,
      'REPRESENTANTE_NO_APLICA',
      'No se requieren datos del representante para una persona adulta.',
    ],
    // B1 (F15): requisitos de aprobación.
    SI460: [409, 'CEDULA_DUPLICADA', 'Ya existe un usuario o una solicitud activa con esta cédula.'],
    SI461: [
      409,
      'IDENTIDAD_NO_VERIFICADA',
      'Falta una verificación de identidad vigente con un método válido.',
    ],
    SI462: [
      409,
      'ESTUDIOS_NO_VERIFICADOS',
      'Falta una verificación de estudios vigente con un método válido.',
    ],
  };
  const entry = typeof sql === 'string' ? map[sql] : undefined;
  if (entry) {
    const [status, code, message] = entry;
    let detalles: Record<string, unknown> | undefined;
    if (sql === 'SI424' && 'details' in error && typeof error.details === 'string') {
      try {
        const value = JSON.parse(error.details) as { faltantes?: unknown };
        if (Array.isArray(value.faltantes))
          detalles = {
            faltantes: value.faltantes.filter(
              (v: unknown) =>
                v === 'cedula' || v === 'titulo_bachiller' || v === 'certificado_estudios',
            ),
          };
      } catch {
        /* Nunca exponer detalles SQL. */
      }
    }
    return new AppError(message, status, { code, detalles });
  }
  if (sql === '23505') return solicitudError(MENSAJE_DATOS_DUPLICADOS, 409, 'DATOS_NO_REGISTRADOS');
  const code = 'code' in error ? error.code : undefined;
  if (code === 'SI409')
    return solicitudError('La solicitud está cerrada o en resolución', 409, 'SOLICITUD_CERRADA');
  if (code === 'SI403')
    return solicitudError('Acepta el aviso y los términos vigentes', 409, 'CONSENTIMIENTO_REQUERIDO');
  return error;
}
