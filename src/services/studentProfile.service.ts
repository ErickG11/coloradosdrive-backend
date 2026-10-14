import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import { AppError } from '../utils/AppError';
import { isValidCedulaEcuatoriana } from '../utils/cedula';

export const profileFields = {
  cedula: 'cedula',
  nombreCompleto: 'nombre_completo',
  telefono: 'telefono',
  fechaNacimiento: 'fecha_nacimiento',
  tipoSangre: 'tipo_sangre',
  genero: 'genero',
  ciudadania: 'ciudadania',
  direccion: 'direccion',
} as const;
export type StudentProfilePatch = { updatedAt: string; correo?: string } & Partial<
  Record<keyof typeof profileFields, string | null>
>;
export interface StudentProfileResult extends Record<string, unknown> {
  operationId: string;
  updatedAt: string;
  changedFields: string[];
}

function saveError(code: string, constraint?: string): AppError {
  if (code === '23505' && constraint === 'users_cedula_unique')
    return new AppError('La cédula ya está registrada', 409);
  if (code === '23505' && constraint === 'student_profile_audit_pkey')
    return new AppError('Conflicto de identificador de guardado. Revisa el alumno', 409);
  if (code === 'CD409') return new AppError('El alumno cambió. Recarga la ficha', 409);
  if (code === 'CD404') return new AppError('Alumno no encontrado', 404);
  if (code === '22023') return new AppError('Datos del perfil inválidos', 400);
  return new AppError('No se pudo confirmar el guardado del alumno', 503);
}

export class StudentProfileService {
  constructor(private readonly db: SupabaseClient<Database>) {}

  async update(
    actor: string,
    studentId: string,
    patch: StudentProfilePatch,
  ): Promise<StudentProfileResult> {
    const operationId = randomUUID();
    const log = (event: string, code?: string): void => {
      console.error(
        JSON.stringify({
          event,
          student_id: studentId,
          operation_id: operationId,
          ...(code ? { code } : {}),
        }),
      );
    };
    if (
      patch.cedula !== undefined &&
      (typeof patch.cedula !== 'string' || !isValidCedulaEcuatoriana(patch.cedula))
    )
      throw new AppError('Cédula ecuatoriana inválida', 400);
    const { data: student, error: readError } = await this.db
      .from('users')
      .select()
      .eq('id', studentId)
      .eq('rol', 'estudiante')
      .maybeSingle();
    if (readError) throw new AppError('No se pudo consultar el alumno', 503);
    if (!student) throw new AppError('Alumno no encontrado', 404);
    // Keep PostgreSQL's microseconds: never convert the version through Date.
    if (student.updated_at !== patch.updatedAt)
      throw new AppError('El alumno cambió. Recarga la ficha', 409);
    if (patch.cedula !== undefined) {
      const { data: duplicate, error } = await this.db
        .from('users')
        .select('id')
        .eq('cedula', patch.cedula)
        .neq('id', studentId)
        .maybeSingle();
      if (error) throw new AppError('No se pudo validar la cédula', 503);
      if (duplicate) throw new AppError('La cédula ya está registrada', 409);
    }
    const profile: Record<string, string | null> = {};
    for (const [field, column] of Object.entries(profileFields)) {
      const value = patch[field as keyof typeof profileFields];
      if (value !== undefined) profile[column] = value;
    }
    let oldEmail: string | undefined;
    let emailChanged = false;
    if (patch.correo !== undefined) {
      try {
        const identity = await this.db.auth.admin.getUserById(studentId);
        if (identity.error || !identity.data.user.email) throw new Error('unavailable');
        oldEmail = identity.data.user.email;
      } catch {
        throw new AppError('No se pudo consultar el correo actual', 503);
      }
      emailChanged = oldEmail !== patch.correo;
      if (emailChanged) {
        console.warn(
          JSON.stringify({
            event: 'student_auth_email_update_start',
            student_id: studentId,
            operation_id: operationId,
            campo: 'correo',
          }),
        );
        try {
          const auth = await this.db.auth.admin.updateUserById(studentId, {
            email: patch.correo,
            email_confirm: true,
          });
          if (auth.error) throw new AppError('Auth rechazó el cambio de correo', 400);
        } catch (error) {
          log('student_auth_email_update_failed');
          if (error instanceof AppError) throw error;
          // Transport failure in Auth is also ambiguous; no blind second mutation.
          throw new AppError('No se pudo confirmar el cambio en Auth. Revisa la identidad', 503);
        }
      }
    }
    let failureCode = '';
    let constraint: string | undefined;
    try {
      const result = await this.db.rpc('save_student_profile', {
        p_actor: actor,
        p_student: studentId,
        p_operation: operationId,
        p_base_version: patch.updatedAt,
        p_profile: profile,
        p_email_changed: emailChanged,
      });
      if (!result.error) return result.data;
      failureCode = result.error.code;
      // PostgREST exposes the constraint in message, not as a separate field.
      // Extract its name only; never log message/details, which can contain values.
      if (failureCode === '23505')
        constraint = /unique constraint "([^"]+)"/.exec(result.error.message)?.[1];
    } catch {
      log('student_profile_manual_review_required');
      throw new AppError(
        'No se pudo confirmar el guardado. Revisar manualmente antes de editar',
        503,
      );
    }
    log('student_profile_save_failed', failureCode);
    const definitive = ['23505', 'CD409', '22023', 'CD404'].includes(failureCode);
    if (!definitive) {
      log('student_profile_manual_review_required', failureCode);
      throw new AppError(
        'No se pudo confirmar el guardado. Revisar manualmente antes de editar',
        503,
      );
    }
    if (emailChanged && oldEmail) {
      try {
        const compensation = await this.db.auth.admin.updateUserById(studentId, {
          email: oldEmail,
          email_confirm: true,
        });
        if (compensation.error) throw new Error('rejected');
        log('student_auth_email_compensated');
      } catch {
        log('student_auth_email_compensation_failed');
        throw new AppError('No se pudo revertir el correo. Requiere revisión administrativa', 503);
      }
    }
    throw saveError(failureCode, constraint);
  }
}
