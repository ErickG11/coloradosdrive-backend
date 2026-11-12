import { individualEnrollmentAccess } from './individualEnrollmentAccess.service';
import { expireStudentSchedule } from './studentScheduleExpiry.service';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import { AppError } from '../utils/AppError';
import { logSafeError } from '../utils/safeLog';

export const MENSAJE_INSCRIPCION_INCOMPLETA =
  'Completa tu inscripción: elige tu horario y confirma el pago para acceder a la plataforma.';

export async function inscripcionIncompleta(
  db: SupabaseClient<Database>,
  studentId: string,
): Promise<boolean> {
  const access = await individualEnrollmentAccess(db, studentId);
  if (access.active && access.enrollments.some((e) => e.eligible)) return false;
  const { data, error } = await db
    .from('enrollments')
    .select('id,etapa_inscripcion,reserva_expira_at')
    .eq('student_id', studentId)
    .eq('origen', 'solicitud')
    .neq('etapa_inscripcion', 'activa')
    .in('status', ['activo', 'pendiente_cohorte'])
    .limit(100);
  if (error) {
    logSafeError('student_enrollment_access_failed', error);
    throw new AppError('No se pudo verificar tu inscripción. Intenta nuevamente.', 503, {
      code: 'INSCRIPCION_NO_DISPONIBLE',
    });
  }
  if (data.some((r) => r.etapa_inscripcion === 'reservado'))
    await expireStudentSchedule(db, studentId);
  return data.length > 0;
}

// Lista cerrada: cualquier nueva ruta autenticada queda bloqueada por defecto.
export function permiteInscripcionIncompleta(method: string, mountedPath: string): boolean {
  const path = mountedPath.replace(/\/+$/, '');
  if (['GET', 'POST'].includes(method) && path === '/estudiantes/inscripcion/espera') return true;
  if (method === 'GET' && /^\/estudiantes\/estado-inscripcion\/[\da-f-]{36}$/i.test(path))
    return true;
  if (
    method === 'GET' &&
    [
      '/estudiantes/estado-inscripcion',
      '/estudiantes/account-status',
      '/notifications',
      '/estudiantes/inscripcion/horario/config',
      '/estudiantes/inscripcion/matriculas',
    ].includes(path)
  )
    return true;
  if (
    method === 'POST' &&
    ['/estudiantes/cambiar-password', '/notifications/read-all'].includes(path)
  )
    return true;
  if (
    method === 'GET' &&
    (path === '/estudiantes/inscripcion/reserva' ||
      /^\/estudiantes\/inscripcion\/reserva\/matricula\/[\da-f-]{36}$/i.test(path))
  )
    return true;
  if (
    method === 'POST' &&
    ([
      '/estudiantes/inscripcion/horario/calendario',
      '/estudiantes/inscripcion/horario/opciones',
      '/estudiantes/inscripcion/horario/plan',
      '/estudiantes/inscripcion/reservas',
    ].includes(path) ||
      /^\/estudiantes\/inscripcion\/reservas\/[\da-f-]{36}\/(ampliar|liberar)$/i.test(path))
  )
    return true;
  if (
    method === 'GET' &&
    (['/estudiantes/inscripcion/pagos/config', '/estudiantes/inscripcion/pagos/actual'].includes(
      path,
    ) ||
      /^\/estudiantes\/inscripcion\/pagos\/matricula\/[\da-f-]{36}\/actual$/i.test(path) ||
      /^\/estudiantes\/inscripcion\/pagos\/[\da-f-]{36}$/i.test(path) ||
      /^\/estudiantes\/inscripcion\/pagos\/reserva\/[\da-f-]{36}\/cotizacion$/i.test(path))
  )
    return true;
  if (
    method === 'POST' &&
    (path === '/estudiantes/inscripcion/pagos' ||
      /^\/estudiantes\/inscripcion\/pagos\/[\da-f-]{36}\/(simular|cobrar)$/i.test(path))
  )
    return true;
  return method === 'PATCH' && /^\/notifications\/[\da-f-]{36}\/read$/i.test(path);
}
