import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import { AppError } from '../utils/AppError';
import { requireKnownFields, sanitizeEnrollmentText } from '../utils/enrollmentSanitization';

const ERRORS: Partial<Record<string, [number, string, string]>> = {
  IP403: [403, 'ACCESO_DENEGADO', 'Se requiere un administrador activo.'],
  IP404: [404, 'ALUMNO_NO_ENCONTRADO', 'Alumno no encontrado.'],
  IP412: [409, 'ALUMNO_SIN_SOLICITUD', 'La matrícula más reciente no proviene de una solicitud.'],
  IP410: [
    409,
    'VENTANA_IDENTIDAD_NO_VENCIDA',
    'La confirmación manual requiere una práctica cuyo plazo del instructor ya venció (48 horas después del fin).',
  ],
  IP422: [400, 'MOTIVO_INVALIDO', 'Escribe un motivo de 10 a 300 caracteres.'],
};

export class StudentIdentityService {
  constructor(private readonly db: SupabaseClient<Database>) {}

  async confirmar(
    studentId: string,
    actorId: string,
    input: unknown,
  ): Promise<Database['public']['Functions']['confirmar_identidad_presencial_admin']['Returns']> {
    requireKnownFields(input, ['motivo']);
    if (typeof input.motivo !== 'string' || input.motivo.length > 1200)
      throw new AppError('Escribe un motivo de 10 a 300 caracteres.', 400, {
        code: 'MOTIVO_INVALIDO',
      });
    const motivo = sanitizeEnrollmentText(input.motivo);
    if (Array.from(motivo).length < 10 || Array.from(motivo).length > 300)
      throw new AppError('Escribe un motivo de 10 a 300 caracteres.', 400, {
        code: 'MOTIVO_INVALIDO',
      });
    const { data, error } = await this.db.rpc('confirmar_identidad_presencial_admin', {
      p_student: studentId,
      p_actor: actorId,
      p_motivo: motivo,
    });
    if (error) {
      const mapped = ERRORS[error.code];
      if (mapped) throw new AppError(mapped[2], mapped[0], { code: mapped[1] });
      console.error(
        JSON.stringify({ event: 'student_identity_override_failed', code: error.code }),
      );
      throw new AppError(
        'No se pudo confirmar la identidad. Recarga la ficha e intenta nuevamente.',
        503,
        { code: 'IDENTIDAD_NO_CONFIRMADA' },
      );
    }
    return data;
  }
}
