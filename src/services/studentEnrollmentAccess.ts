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
  const { data, error } = await db
    .from('enrollments')
    .select('id')
    .eq('student_id', studentId)
    .eq('origen', 'solicitud')
    .neq('etapa_inscripcion', 'activa')
    .in('status', ['activo', 'pendiente_cohorte'])
    .limit(1);
  if (error) {
    logSafeError('student_enrollment_access_failed', error);
    throw new AppError('No se pudo verificar tu inscripción. Intenta nuevamente.', 503, {
      code: 'INSCRIPCION_NO_DISPONIBLE',
    });
  }
  return data.length > 0;
}

// Lista cerrada: cualquier nueva ruta autenticada queda bloqueada por defecto.
export function permiteInscripcionIncompleta(method: string, mountedPath: string): boolean {
  const path = mountedPath.replace(/\/+$/, '');
  if (
    method === 'GET' &&
    ['/estudiantes/estado-inscripcion', '/estudiantes/account-status', '/notifications'].includes(
      path,
    )
  )
    return true;
  if (
    method === 'POST' &&
    ['/estudiantes/cambiar-password', '/notifications/read-all'].includes(path)
  )
    return true;
  return method === 'PATCH' && /^\/notifications\/[\da-f-]{36}\/read$/i.test(path);
}
