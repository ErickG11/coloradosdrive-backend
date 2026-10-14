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
  updatedAt: string | null;
  changedFields: string[];
}

function saveError(code: string): AppError {
  if (code === '23505') return new AppError('La cédula ya está registrada', 409);
  if (code === 'CD409') return new AppError('El alumno cambió. Recarga la ficha', 409);
  if (code === 'CD404') return new AppError('Alumno no encontrado', 404);
  if (code === '42501') return new AppError('Se requiere administrador', 403);
  if (['22023', '22007', '22008', '23514', '22001'].includes(code))
    return new AppError('Datos del perfil inválidos', 400);
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
    let uncertain = false;
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
      uncertain =
        !failureCode ||
        !/^[0-9A-Z]{5}$/.test(failureCode) ||
        failureCode.startsWith('PGRST') ||
        ['57014', '08000', '08003', '08006', '08001', '08004', '08007', '08P01'].includes(
          failureCode,
        );
    } catch {
      uncertain = true;
    }
    log('student_profile_save_failed', failureCode);
    if (uncertain) {
      try {
        const confirmation = await this.db
          .from('student_profile_audit')
          .select('operation_id,student_id,actor_id,changed_fields')
          .eq('operation_id', operationId)
          .maybeSingle();
        if (confirmation.error) throw new Error('unavailable');
        if (confirmation.data) {
          if (confirmation.data.student_id !== studentId || confirmation.data.actor_id !== actor)
            throw new Error('invalid confirmation');
          log('student_profile_commit_confirmed');
          return {
            operationId,
            changedFields: confirmation.data.changed_fields,
            updatedAt: null,
            refreshRequired: true,
          };
        }
      } catch {
        log('student_profile_confirmation_unavailable');
        throw new AppError('Guardado incierto. Revisa el alumno antes de volver a editar', 503);
      }
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
    throw saveError(failureCode);
  }
}
