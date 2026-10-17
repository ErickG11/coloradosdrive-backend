import type { SupabaseClient } from '@supabase/supabase-js';
import { DateTime } from 'luxon';
import type { Database } from '../config/database.types';
import type { StudentCohortOptions, StudentCohortResult } from '../models/studentCohort.model';
import { AppError } from '../utils/AppError';
import { SCHOOL_TIMEZONE } from '../utils/schoolTimezone';
import {
  assignCohort,
  CohortAssignmentService,
  isCohortWindowOpen,
  schoolToday,
} from './cohortAssignment.service';
import { assertStudentMutable } from './studentDeletion.service';

export function studentCohortError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const code = (error as { code?: string } | null)?.code;
  const known: Record<string, [number, string, string]> = {
    CD001: [409, 'COHORT_FULL', 'La cohorte ya no tiene cupo'],
    CD030: [409, 'DELETION_PENDING', 'El alumno tiene una eliminación pendiente'],
    CD403: [403, 'ACCOUNT_INACTIVE', 'Reactiva al alumno antes de asignar cohorte'],
    CD404: [404, 'STUDENT_NOT_FOUND', 'Alumno no encontrado'],
    CD040: [404, 'ENROLLMENT_NOT_FOUND', 'Matrícula no encontrada'],
    CD041: [409, 'ENROLLMENT_NOT_PENDING', 'La matrícula ya no está pendiente de cohorte; recarga'],
    CD042: [404, 'COHORT_NOT_FOUND', 'Cohorte no encontrada'],
    CD043: [400, 'COHORT_COURSE_MISMATCH', 'La cohorte no corresponde al curso de la matrícula'],
    CD044: [409, 'COHORT_CHANGED', 'La cohorte o el día cambiaron; recarga antes de confirmar'],
    CD045: [409, 'ABONO_EXCEEDS_NET', 'El abono supera el neto de la cohorte'],
    '22023': [400, 'INVALID_FIELD', 'Datos de asignación inválidos'],
    '42501': [403, 'FORBIDDEN', 'Se requiere administrador'],
    '55P03': [409, 'LOCK_CONFLICT', 'La matrícula está ocupada; recarga y vuelve a intentar'],
    '40P01': [
      409,
      'LOCK_CONFLICT',
      'Hubo un conflicto de operaciones; recarga y vuelve a intentar',
    ],
  };
  const entry = code ? known[code] : undefined;
  if (entry) return new AppError(entry[2], entry[0], { code: entry[1] });
  return new AppError(
    'No se pudo confirmar la asignación; recarga la ficha y verifica antes de reintentar',
    503,
    { code: 'UNCONFIRMED' },
  );
}

export class StudentCohortService {
  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly cohorts = new CohortAssignmentService(db),
  ) {}

  private async enrollment(
    student: string,
    enrollment: string,
  ): Promise<Database['public']['Tables']['enrollments']['Row']> {
    await assertStudentMutable(this.db, student);
    const user = await this.db
      .from('users')
      .select('id,activo')
      .eq('id', student)
      .eq('rol', 'estudiante')
      .maybeSingle();
    if (user.error) throw user.error;
    if (!user.data) throw studentCohortError({ code: 'CD404' });
    if (!user.data.activo) throw studentCohortError({ code: 'CD403' });
    const result = await this.db
      .from('enrollments')
      .select()
      .eq('id', enrollment)
      .eq('student_id', student)
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw studentCohortError({ code: 'CD040' });
    return result.data;
  }

  async options(student: string, enrollment: string): Promise<StudentCohortOptions> {
    try {
      const e = await this.enrollment(student, enrollment);
      if (e.status !== 'pendiente_cohorte') throw studentCohortError({ code: 'CD041' });
      const candidates = await this.cohorts.candidatesForCourse(e.course_id);
      const today = schoolToday();
      const civil = (date: Date): string =>
        DateTime.fromJSDate(date, { zone: SCHOOL_TIMEZONE }).toFormat('yyyy-MM-dd');
      return {
        enrollmentId: e.id,
        courseId: e.course_id,
        suggestion: assignCohort(today, candidates),
        items: candidates
          .filter((c) => assignCohort(today, [c]).cohortId !== null)
          .map((c) => ({
            id: c.id,
            nombre: c.nombre ?? null,
            precio: c.precio,
            cuposDisponibles: c.cupoMaximo - c.cupoOcupado,
            fechaInicioMatricula: civil(c.fechaInicioMatricula),
            fechaFinMatricula: civil(c.fechaFinMatricula),
            fechaInicioCurso: civil(c.fechaInicioCurso),
          })),
      };
    } catch (error) {
      throw studentCohortError(error);
    }
  }

  async assign(
    actor: string,
    student: string,
    enrollment: string,
    cohort: string,
  ): Promise<StudentCohortResult> {
    try {
      const e = await this.enrollment(student, enrollment);
      const repeat = e.status === 'activo' && e.cohort_id === cohort;
      if (e.status !== 'pendiente_cohorte' && !repeat) throw studentCohortError({ code: 'CD041' });
      const candidates = await this.cohorts.candidatesForCourse(e.course_id);
      const chosen = candidates.find((c) => c.id === cohort);
      if (!chosen) {
        const other = await this.db.from('cohorts').select('id').eq('id', cohort).maybeSingle();
        if (other.error) throw other.error;
        throw studentCohortError({ code: other.data ? 'CD043' : 'CD042' });
      }
      const today = schoolToday();
      if (!repeat && !isCohortWindowOpen(today, chosen)) {
        throw new AppError('La ventana de matrícula no está abierta', 409, {
          code: 'COHORT_WINDOW_CLOSED',
        });
      }
      // No convertir updatedAt a Date: preservar todos los microsegundos recibidos.
      if (!chosen.updatedAt) throw studentCohortError(null);
      const { data, error } = await this.db.rpc('assign_pending_enrollment_cohort', {
        p_actor: actor,
        p_student: student,
        p_enrollment: enrollment,
        p_cohort: cohort,
        p_cohort_version: chosen.updatedAt,
        p_validated_day: DateTime.fromJSDate(today, { zone: SCHOOL_TIMEZONE }).toFormat(
          'yyyy-MM-dd',
        ),
      });
      if (error) throw error;
      if (data.status !== 'activo' || data.cohort_id !== cohort || data.monto_total === null)
        throw studentCohortError(null);
      return {
        enrollmentId: data.id,
        cohortId: data.cohort_id,
        status: 'activo',
        montoTotal: Number(data.monto_total),
        descuento: Number(data.descuento),
        montoAbonado: Number(data.monto_abonado),
        saldo: Math.round((Number(data.monto_total) - Number(data.monto_abonado)) * 100) / 100,
        updatedAt: data.updated_at,
      };
    } catch (error) {
      const mapped = studentCohortError(error);
      if (mapped.code === 'UNCONFIRMED')
        console.error(
          JSON.stringify({
            event: 'student_cohort_unconfirmed',
            student_id: student,
            enrollment_id: enrollment,
            actor_id: actor,
          }),
        );
      throw mapped;
    }
  }
}
