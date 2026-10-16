import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import type { StudentListQuery, StudentListResult } from '../models/studentAdmin.model';
import { AppError } from '../utils/AppError';
import {
  summarizeEnrollmentDetails,
  type ManualEnrollmentDetails,
} from './manualEnrollmentDetails.service';

import {
  studentGraduation,
  studentSchedule,
  type StudentGraduation,
  type StudentSchedule,
} from './studentGraduation';

type UserRow = Database['public']['Tables']['users']['Row'];
type EnrollmentRow = Database['public']['Tables']['enrollments']['Row'];
type CourseRow = Database['public']['Tables']['courses']['Row'];
type CohortRow = Database['public']['Tables']['cohorts']['Row'];

export interface StudentDetail {
  id: string;
  cedula: string;
  nombreCompleto: string;
  telefono: string | null;
  activo: boolean;
  status: UserRow['status'];
  mustChangePassword: boolean;
  correo: string | null;
  correoDisponible: boolean;
  fechaNacimiento: string | null;
  tipoSangre: string | null;
  genero: string | null;
  ciudadania: string | null;
  direccion: string | null;
  createdAt: string;
  updatedAt: string;
  graduation: StudentGraduation;
  practiceSchedule: StudentSchedule;
  enrollments: (ManualEnrollmentDetails & {
    status: EnrollmentRow['status'];
    courseId: string;
    courseType: 'A' | 'B';
    fechaInscripcion: string;
    curso: Pick<CourseRow, 'id' | 'nombre' | 'tipo'> | null;
    cohorte: Pick<CohortRow, 'id' | 'nombre' | 'fecha_inicio_curso' | 'fecha_fin_curso'> | null;
  })[];
}

function databaseError(error: Pick<PostgrestError, 'code'>): AppError {
  if (error.code === '42501') return new AppError('Se requiere administrador', 403);
  if (error.code === '22023') return new AppError('Filtros de estudiantes inválidos', 400);
  console.error(
    JSON.stringify({
      event: 'student_read_failed',
      code: error.code,
      schemaUnavailable: ['PGRST202', '42P01', '42883'].includes(error.code),
    }),
  );
  return new AppError('No se pudo consultar estudiantes. Inténtalo nuevamente', 503);
}

export class StudentAdminService {
  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly now = (): Date => new Date(),
  ) {}

  async list(actor: string, query: StudentListQuery): Promise<StudentListResult> {
    const { data, error } = await this.db.rpc('list_admin_students', {
      p_actor: actor,
      p_q: query.q ?? null,
      p_active: query.activo ?? null,
      p_course: query.courseId ?? null,
      p_cohort: query.cohortId ?? null,
      p_pending: query.pendienteCohorte ?? null,
      p_documents_pending: query.documentosPendientes ?? null,
      p_history: query.incluirHistorial ?? false,
      p_page: query.page,
      p_page_size: query.pageSize,
    });
    if (error) throw databaseError(error);
    return data;
  }

  private async user(id: string): Promise<UserRow> {
    const { data, error } = await this.db
      .from('users')
      .select()
      .eq('id', id)
      .eq('rol', 'estudiante')
      .maybeSingle();
    if (error) throw databaseError(error);
    if (!data) throw new AppError('Alumno no encontrado', 404);
    return data;
  }

  private async email(id: string): Promise<string | null> {
    try {
      const { data, error } = await this.db.auth.admin.getUserById(id);
      if (error || !data.user.email) throw new Error('Unavailable');
      return data.user.email;
    } catch {
      console.warn(JSON.stringify({ event: 'student_email_unavailable', student_id: id }));
      return null;
    }
  }

  async get(id: string): Promise<StudentDetail> {
    const user = await this.user(id);
    const email = this.email(id);
    const { data: enrollments, error } = await this.db
      .from('enrollments')
      .select()
      .eq('student_id', id)
      .order('fecha_inscripcion', { ascending: false })
      .order('id');
    if (error) throw databaseError(error);
    const correo = await email;
    const enrollmentIds = enrollments.map((e) => e.id);
    const courseIds = [...new Set(enrollments.map((e) => e.course_id))];
    const cohortIds = [...new Set(enrollments.flatMap((e) => (e.cohort_id ? [e.cohort_id] : [])))];
    const [
      documentsResult,
      coursesResult,
      cohortsResult,
      examsResult,
      attemptsResult,
      slotsResult,
      recoveryResult,
    ] = await Promise.all([
      enrollmentIds.length
        ? this.db.from('enrollment_documents').select().in('enrollment_id', enrollmentIds)
        : Promise.resolve({ data: [], error: null }),
      courseIds.length
        ? this.db.from('courses').select('id,nombre,tipo').in('id', courseIds)
        : Promise.resolve({ data: [], error: null }),
      cohortIds.length
        ? this.db
            .from('cohorts')
            .select('id,nombre,fecha_inicio_curso,fecha_fin_curso')
            .in('id', cohortIds)
        : Promise.resolve({ data: [], error: null }),
      courseIds.length
        ? this.db
            .from('exams')
            .select('id,course_id')
            .in('course_id', courseIds)
            .eq('type', 'definitivo')
            .eq('is_published', true)
        : Promise.resolve({ data: [], error: null }),
      courseIds.length
        ? this.db.from('exam_attempts').select('exam_id,status,passed').eq('student_id', id)
        : Promise.resolve({ data: [], error: null }),
      this.db
        .from('practice_slots')
        .select('id,cohort_id,instructor_id,scheduled_at,duration_minutes,status,attended')
        .eq('student_id', id)
        .order('scheduled_at')
        .order('id'),
      this.db
        .from('student_practice_recovery')
        .select('slot_id,cohort_id,instructor_id,scheduled_at,status,reason')
        .eq('student_id', id)
        .in('status', ['cancelada_por_desactivacion', 'pendiente_reprogramar'])
        .order('scheduled_at')
        .order('slot_id'),
    ]);
    for (const result of [
      documentsResult,
      coursesResult,
      cohortsResult,
      examsResult,
      attemptsResult,
      slotsResult,
      recoveryResult,
    ])
      if (result.error) throw databaseError(result.error);
    const slots = slotsResult.data ?? [];
    const recovery = recoveryResult.data ?? [];
    const instructorIds = [
      ...new Set([...slots.map((s) => s.instructor_id), ...recovery.map((r) => r.instructor_id)]),
    ];
    const instructors = instructorIds.length
      ? await this.db
          .from('users')
          .select('id,nombre_completo')
          .in('id', instructorIds)
          .eq('rol', 'instructor')
      : { data: [], error: null };
    if (instructors.error) throw databaseError(instructors.error);
    return {
      graduation: studentGraduation(
        enrollments,
        documentsResult.data ?? [],
        coursesResult.data ?? [],
        examsResult.data ?? [],
        attemptsResult.data ?? [],
        slots,
      ),
      practiceSchedule: studentSchedule(slots, recovery, instructors.data, this.now()),
      id: user.id,
      cedula: user.cedula,
      nombreCompleto: user.nombre_completo,
      telefono: user.telefono,
      activo: user.activo,
      status: user.status,
      mustChangePassword: user.debe_cambiar_password,
      correo,
      correoDisponible: correo !== null,
      fechaNacimiento: user.fecha_nacimiento,
      tipoSangre: user.tipo_sangre,
      genero: user.genero,
      ciudadania: user.ciudadania,
      direccion: user.direccion,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
      enrollments: enrollments.map((e) => ({
        ...summarizeEnrollmentDetails(
          e,
          (documentsResult.data ?? []).filter((d) => d.enrollment_id === e.id),
        ),
        status: e.status,
        courseId: e.course_id,
        courseType: e.course_type,
        fechaInscripcion: e.fecha_inscripcion,
        curso: coursesResult.data?.find((c) => c.id === e.course_id) ?? null,
        cohorte: cohortsResult.data?.find((c) => c.id === e.cohort_id) ?? null,
      })),
    };
  }
}
