import { AppError } from './AppError';

// Compatibilidad con errores previos; los nuevos casos asignan code explícitamente.
export function solicitudErrorCode(error: unknown): string {
  if (!(error instanceof AppError)) return 'ERROR_INTERNO';
  if (error.code) return error.code;
  if (error.message.startsWith('motivoRechazo')) return 'MOTIVO_REQUERIDO';
  if (error.message === 'codigo debe tener 6 dígitos' || error.message === 'Código inválido o vencido') return 'CODIGO_INVALIDO_O_VENCIDO';
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

export function normalizeSolicitudError(error: Error): Error {
  const sql = 'code' in error ? error.code : undefined;
  const map: Record<string,[number,string,string]> = {SI404:[404,'NO_ENCONTRADO','La solicitud o el documento no existe'],SI401:[403,'CORREO_NO_VERIFICADO','Verifica tu correo'],SI410:[409,'SOLICITUD_ENVIADA','La solicitud ya fue enviada'],SI411:[409,'DOCUMENTO_YA_REVISADO','Este documento ya fue revisado'],SI412:[409,'DOCUMENTO_YA_APROBADO','Este documento ya fue aprobado'],SI413:[409,'SOLICITUD_NO_ENVIADA','La solicitud no ha sido enviada'],SI422:[400,'DATOS_REQUERIDOS','Completa tus datos personales'],SI423:[400,'REPRESENTANTE_REQUERIDO','Completa los datos y la autorización del representante'],SI424:[400,'SOLICITUD_INCOMPLETA','Faltan documentos obligatorios']};
  if (typeof sql === 'string' && map[sql]) {
    const [status,code,message]=map[sql];
    let detalles: Record<string,unknown> | undefined;
    if(sql==='SI424' && 'details' in error && typeof error.details==='string') {
      try { const value=JSON.parse(error.details) as {faltantes?:unknown}; if(Array.isArray(value.faltantes))detalles={faltantes:value.faltantes.filter((v:unknown)=>v==='cedula'||v==='titulo_bachiller')}; }catch { /* Nunca exponer detalles SQL. */ }
    }
    return new AppError(message,status,{code,detalles});
  }
  if (sql === '23505') return solicitudError('La cédula ya está registrada',409,'CEDULA_YA_REGISTRADA');
  const code = 'code' in error ? error.code : undefined;
  if (code === 'SI409') return solicitudError('La solicitud está cerrada o en resolución', 409, 'SOLICITUD_CERRADA');
  if (code === 'SI403') return solicitudError('Acepta el aviso de privacidad vigente', 409, 'CONSENTIMIENTO_REQUERIDO');
  return error;
}
