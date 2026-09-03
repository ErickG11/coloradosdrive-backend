import { randomBytes } from 'node:crypto';

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../config/database.types';
import type { CreateEnrollmentInput, Enrollment } from '../models/enrollment.model';
import type { UserProfile } from '../models/user.model';
import { AppError } from '../utils/AppError';
import type { EmailService } from './email.service';

type CohortRow = Database['public']['Tables']['cohorts']['Row'];
type EnrollmentRow = Database['public']['Tables']['enrollments']['Row'];
type UserRow = Database['public']['Tables']['users']['Row'];

const POSTGRES_UNIQUE_VIOLATION = '23505';

function toEnrollment(row: EnrollmentRow): Enrollment {
  return {
    id: row.id,
    studentId: row.student_id,
    cohortId: row.cohort_id,
    status: row.status,
    montoTotal: Number(row.monto_total),
    fechaInscripcion: row.fecha_inscripcion,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toUserProfile(row: UserRow): UserProfile {
  return {
    id: row.id,
    cedula: row.cedula,
    nombreCompleto: row.nombre_completo,
    telefono: row.telefono,
    rol: row.rol,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function generateTemporaryPassword(): string {
  // 12 bytes -> 16 caracteres en base64url, suficiente entropía para una
  // contraseña temporal de un solo uso.
  return randomBytes(12).toString('base64url');
}

export interface EnrollStudentResult {
  student: UserProfile;
  enrollment: Enrollment;
}

// RF-01: una sola operación crea la cuenta del estudiante en Supabase Auth,
// su fila en `users`, lo inscribe en la cohorte, y envía el correo de
// bienvenida. Si un paso falla después de crear el usuario en Auth, se
// compensa borrándolo (ver docs/adr/002 sobre esta decisión).
export class EnrollmentService {
  constructor(
    private readonly supabase: SupabaseClient<Database>,
    private readonly emailService: EmailService,
  ) {}

  async enrollStudent(input: CreateEnrollmentInput): Promise<EnrollStudentResult> {
    const cohort = await this.getCohortOrThrow(input.cohortId);
    await this.assertCedulaAvailable(input.cedula);

    const temporaryPassword = generateTemporaryPassword();
    const { data: authData, error: authError } = await this.supabase.auth.admin.createUser({
      email: input.correo,
      password: temporaryPassword,
      email_confirm: true,
      app_metadata: { role: 'estudiante' },
    });

    if (authError) {
      throw authError;
    }

    const studentId = authData.user.id;

    try {
      const userRow = await this.createUserRow(studentId, input);
      const enrollmentRow = await this.createEnrollmentRow(studentId, input.cohortId, cohort);

      await this.sendWelcomeEmailSafely(input.correo, input.nombreCompleto, temporaryPassword);

      return { student: toUserProfile(userRow), enrollment: toEnrollment(enrollmentRow) };
    } catch (err) {
      await this.supabase.auth.admin.deleteUser(studentId).catch(() => undefined);
      throw err;
    }
  }

  private async getCohortOrThrow(cohortId: string): Promise<CohortRow> {
    const { data, error } = await this.supabase
      .from('cohorts')
      .select()
      .eq('id', cohortId)
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (!data) {
      throw new AppError('La cohorte indicada no existe', 404);
    }

    return data;
  }

  private async assertCedulaAvailable(cedula: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('users')
      .select('id')
      .eq('cedula', cedula)
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (data) {
      throw new AppError('La cédula ya está registrada', 409);
    }
  }

  private async createUserRow(studentId: string, input: CreateEnrollmentInput): Promise<UserRow> {
    const { data, error } = await this.supabase
      .from('users')
      .insert({
        id: studentId,
        cedula: input.cedula,
        nombre_completo: input.nombreCompleto,
        telefono: input.telefono ?? null,
        rol: 'estudiante',
      })
      .select()
      .single();

    if (error) {
      throw this.translateUniqueViolation(error, 'La cédula ya está registrada');
    }

    return data;
  }

  private async createEnrollmentRow(
    studentId: string,
    cohortId: string,
    cohort: CohortRow,
  ): Promise<EnrollmentRow> {
    const { data, error } = await this.supabase
      .from('enrollments')
      .insert({
        student_id: studentId,
        cohort_id: cohortId,
        monto_total: Number(cohort.precio),
      })
      .select()
      .single();

    if (error) {
      throw this.translateUniqueViolation(error, 'El estudiante ya está activo en otra cohorte');
    }

    return data;
  }

  private translateUniqueViolation(error: PostgrestError, message: string): Error {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) {
      return new AppError(message, 409);
    }
    return error;
  }

  private async sendWelcomeEmailSafely(
    to: string,
    nombreCompleto: string,
    temporaryPassword: string,
  ): Promise<void> {
    try {
      await this.emailService.sendWelcomeEmail({ to, nombreCompleto, temporaryPassword });
    } catch (err) {
      // No se revierte la matrícula si falla el envío del correo: la
      // cuenta y la inscripción ya son válidas, el correo es best-effort.
      console.error('No se pudo enviar el correo de bienvenida:', err);
    }
  }
}
