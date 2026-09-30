import { createHash, randomUUID, randomBytes } from 'node:crypto';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { DateTime } from 'luxon';
import type { Database, CourseType, ManualOperation } from '../config/database.types';
import type {
  ManualEnrollmentInput,
  ManualEnrollmentResult,
  ManualPracticeInput,
} from '../models/manualEnrollment.model';
import { AppError } from '../utils/AppError';
import { manualPracticePlan, type ManualPracticePlan } from '../utils/manualPracticePlan';
import { SCHOOL_TIMEZONE } from '../utils/schoolTimezone';
import {
  CohortAssignmentService,
  type AssignCohortForCourseResult,
} from './cohortAssignment.service';
import type { EmailService } from './email.service';
import { PracticeSlotGenerationService } from './practiceSlotGeneration.service';
import type { SugerirPracticaResult } from '../models/practiceSlotGeneration.model';

interface CatalogEntry {
  tipo: CourseType;
  nombre: string;
  courseId: string | null;
}
interface StudentSearchResult {
  id: string;
  cedula: string;
  nombreCompleto: string;
  correo: string;
  vigentes: { tipo: CourseType; status: string }[];
}
interface CoursePreviewResult {
  courseId: string;
  tipo: CourseType;
  suggestion: AssignCohortForCourseResult;
  cohorts: (Database['public']['Tables']['cohorts']['Row'] & { ocupados: number })[];
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export function manualEnrollmentError(error: PostgrestError): Error {
  if (error.code === '23505')
    return new AppError(
      'Ya existe una matrícula vigente del mismo tipo o una cuenta con esa cédula. Selecciona el estudiante existente.',
      409,
    );
  if (['CD001', 'CD020', 'CD021', '23P01'].includes(error.code))
    return new AppError(
      error.code === '23P01'
        ? 'El instructor dejó de estar disponible. Consulta una nueva sugerencia.'
        : error.message,
      409,
    );
  return error;
}

export class ManualEnrollmentService {
  private readonly cohorts: CohortAssignmentService;
  private readonly generator: PracticeSlotGenerationService;
  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly email: EmailService,
  ) {
    this.cohorts = new CohortAssignmentService(db);
    this.generator = new PracticeSlotGenerationService(db);
  }

  async catalog(): Promise<CatalogEntry[]> {
    const { data, error } = await this.db.from('manual_course_catalog').select();
    if (error) throw error;
    return (['A', 'B'] as const).map((tipo) => ({
      tipo,
      nombre: tipo === 'A' ? 'Motocicletas' : 'Vehículos livianos',
      courseId: data.find((c) => c.tipo === tipo)?.course_id ?? null,
    }));
  }
  async search(actor: string, query: string): Promise<StudentSearchResult[]> {
    const { data, error } = await this.db.rpc('find_manual_students', {
      p_actor: actor,
      p_query: query.trim(),
    });
    if (error) throw error;
    const ids = data.map((s) => s.id);
    if (!ids.length) return [];
    const { data: enrollments, error: e } = await this.db
      .from('enrollments')
      .select('student_id,course_type,status')
      .in('student_id', ids)
      .in('status', ['activo', 'pendiente_cohorte']);
    if (e) throw e;
    return data.map((s) => ({
      id: s.id,
      cedula: s.cedula,
      nombreCompleto: s.nombre_completo,
      correo: s.correo,
      vigentes: enrollments
        .filter((e) => e.student_id === s.id)
        .map((e) => ({ tipo: e.course_type, status: e.status })),
    }));
  }
  private async catalogCourse(tipo: CourseType): Promise<string> {
    const c = (await this.catalog()).find((c) => c.tipo === tipo);
    if (!c?.courseId)
      throw new AppError(
        `El catálogo Tipo ${tipo} requiere designar un course_id explícito antes de matricular`,
        409,
      );
    return c.courseId;
  }
  async coursePreview(tipo: CourseType): Promise<CoursePreviewResult> {
    const courseId = await this.catalogCourse(tipo);
    const suggestion = await this.cohorts.assignCohortForCourse(courseId);
    const { data: courses, error: ce } = await this.db
      .from('courses')
      .select('id')
      .eq('tipo', tipo);
    if (ce) throw ce;
    const { data: cohorts, error: e } = await this.db
      .from('cohorts')
      .select()
      .in(
        'course_id',
        courses.map((c) => c.id),
      );
    if (e) throw e;
    const { data: enrollments, error: ee } = await this.db
      .from('enrollments')
      .select('cohort_id')
      .eq('status', 'activo');
    if (ee) throw ee;
    const today = DateTime.now().setZone(SCHOOL_TIMEZONE).toFormat('yyyy-MM-dd');
    const eligible = cohorts
      .map((c) => ({ ...c, ocupados: enrollments.filter((e) => e.cohort_id === c.id).length }))
      .filter(
        (c) =>
          c.fecha_inicio_matricula <= today &&
          today <= c.fecha_fin_matricula &&
          c.ocupados < c.cupo_maximo,
      );
    return { courseId, tipo, suggestion, cohorts: eligible };
  }
  private async resolveCourse(
    input: Pick<ManualEnrollmentInput, 'courseType' | 'cohortId' | 'automatic'>,
  ): Promise<string> {
    const catalog = await this.catalogCourse(input.courseType);
    if (input.automatic) {
      const current = await this.cohorts.assignCohortForCourse(catalog);
      if (current.cohortId !== input.cohortId)
        throw new AppError(
          'La sugerencia de cohorte cambió. Vuelve al paso Curso para actualizarla antes de confirmar.',
          409,
        );
    }
    if (!input.cohortId) {
      if (!input.automatic)
        throw new AppError(
          'Solo se permite pendiente de cohorte cuando el motor no encuentra una elegible',
          400,
        );
      return catalog;
    }
    const { data: cohort, error } = await this.db
      .from('cohorts')
      .select()
      .eq('id', input.cohortId)
      .maybeSingle();
    if (error) throw error;
    if (!cohort) throw new AppError('La cohorte no existe', 404);
    const { data: course, error: ce } = await this.db
      .from('courses')
      .select('tipo')
      .eq('id', cohort.course_id)
      .single();
    if (ce) throw ce;
    if (course.tipo !== input.courseType)
      throw new AppError('La cohorte es de otro tipo de curso', 400);
    const today = DateTime.now().setZone(SCHOOL_TIMEZONE).toFormat('yyyy-MM-dd');
    if (today < cohort.fecha_inicio_matricula || today > cohort.fecha_fin_matricula)
      throw new AppError('La matrícula de la cohorte no está abierta', 409);
    return cohort.course_id;
  }
  async practicePreview(
    input: Pick<ManualEnrollmentInput, 'courseType' | 'cohortId' | 'automatic' | 'practice'>,
  ): Promise<{ plan: ManualPracticePlan; suggestion: SugerirPracticaResult | null }> {
    const plan = manualPracticePlan(input.practice);
    const courseId = await this.resolveCourse(input);
    const suggestion = input.cohortId
      ? await this.generator.suggestForCourse(courseId, {
          fechaInicio: input.practice.fechaInicio,
          fechaFin: plan.fechaFinElegida,
          modalidad: input.practice.modalidad,
          horasPorDia: input.practice.horasPorDia,
          horaDeseada: input.practice.horaDeseada,
        })
      : null;
    return { plan, suggestion };
  }
  private result(op: ManualOperation): ManualEnrollmentResult {
    return { ...op.response, emailStatus: op.email_status } as unknown as ManualEnrollmentResult;
  }
  async operation(actor: string, id: string): Promise<ManualOperation> {
    const { data, error } = await this.db
      .from('manual_enrollment_operations')
      .select()
      .eq('id', id)
      .eq('actor_id', actor)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new AppError('Operación no encontrada', 404);
    return data;
  }
  async confirm(
    actor: string,
    id: string,
    input: ManualEnrollmentInput,
  ): Promise<ManualEnrollmentResult> {
    const worker = randomUUID();
    // Ninguna contraseña forma parte del payload ni del registro de idempotencia.
    const hash = createHash('sha256').update(stable(input)).digest('hex');
    const { data: op, error: re } = await this.db.rpc('reserve_manual_enrollment', {
      p_id: id,
      p_actor: actor,
      p_hash: hash,
      p_worker: worker,
    });
    if (re) throw manualEnrollmentError(re);
    if (op.phase === 'committed') return this.result(op);
    if (!op.claimed)
      throw new AppError(
        `La operación ${id} está ${op.phase === 'needs_review' ? 'pendiente de reconciliación' : 'en curso'}. Consulta su estado; no crees otra solicitud.`,
        409,
      );
    let createdId: string | null = null;
    let authCreationUncertain = false;
    let password: string | undefined;
    try {
      const plan = manualPracticePlan(input.practice);
      const course = await this.resolveCourse(input);
      const scheduled = input.cohortId
        ? await this.generator.prepareForTransaction({
            fechaInicio: input.practice.fechaInicio,
            fechaFin: plan.fechaFinElegida,
            modalidad: input.practice.modalidad,
            horasPorDia: input.practice.horasPorDia,
            horaResuelta: input.practice.horaResuelta ?? input.practice.horaDeseada,
            instructorId: this.requireInstructor(input.practice),
          })
        : [];
      let studentId: string;
      if (input.student.mode === 'existing') {
        studentId = input.student.id;
        const { data, error } = await this.db
          .from('users')
          .select('id,rol')
          .eq('id', studentId)
          .maybeSingle();
        if (error) throw error;
        if (data?.rol !== 'estudiante')
          throw new AppError('Selecciona un estudiante existente válido', 400);
        const { data: identity, error: identityError } =
          await this.db.auth.admin.getUserById(studentId);
        if (identityError || identity.user.app_metadata.role !== 'estudiante')
          throw new AppError(
            'La cuenta y el perfil del estudiante requieren revisión antes de matricular',
            409,
          );
      } else {
        const { data: profile, error } = await this.db
          .from('users')
          .select('id')
          .eq('cedula', input.student.cedula)
          .maybeSingle();
        if (error) throw error;
        if (profile)
          throw new AppError(
            'La cédula ya existe. Busca y selecciona el estudiante existente.',
            409,
          );
        password = randomBytes(18).toString('base64url');
        authCreationUncertain = true;
        const { data, error: ae } = await this.db.auth.admin.createUser({
          email: input.student.correo,
          password,
          email_confirm: true,
          app_metadata: { role: 'estudiante' },
        });
        if (ae) {
          // Un rechazo explícito 4xx acredita que no se creó la identidad.
          // Transporte/5xx o respuesta perdida requieren reconciliar Auth.
          if (ae.status && ae.status >= 400 && ae.status < 500) authCreationUncertain = false;
          throw new AppError(
            ae.code === 'email_exists'
              ? 'El correo ya existe. Busca y selecciona el estudiante existente.'
              : 'No se pudo crear la cuenta de acceso',
            ae.code === 'email_exists' ? 409 : 502,
          );
        }
        studentId = data.user.id;
        createdId = studentId;
        authCreationUncertain = false;
        await this.updateOperation(id, worker, { student_id: studentId, student_created: true });
      }
      const storedPlan = {
        ...input.practice,
        ...plan,
        horaResuelta: input.practice.horaResuelta ?? input.practice.horaDeseada,
      };
      const { data, error: we } = await this.db.rpc('commit_manual_enrollment', {
        p_id: id,
        p_worker: worker,
        p_student: studentId,
        p_profile: input.student.mode === 'new' ? { ...input.student } : null,
        p_course: course,
        p_cohort: input.cohortId,
        p_plan: storedPlan,
        p_scheduled_ats: scheduled,
        p_instructor: input.practice.instructorId ?? null,
      });
      if (we) throw manualEnrollmentError(we);
      // La matrícula ya fue confirmada. El envío y su estado no participan
      // en la compensación de Auth ni revierten el commit relacional.
      await this.sendEmail(actor, id, password).catch(() => undefined);
      return {
        ...data,
        emailStatus: (await this.operation(actor, id)).email_status,
      } as unknown as ManualEnrollmentResult;
    } catch (error) {
      // Una respuesta perdida de la RPC NO demuestra rollback. Consultar el
      // registro antes de cualquier compensación; si no responde, conservar.
      let current: ManualOperation;
      try {
        const { data, error: fence } = await this.db.rpc('abort_manual_enrollment', {
          p_id: id,
          p_worker: worker,
        });
        if (fence) throw fence;
        current = data;
      } catch {
        throw new AppError(
          `Resultado incierto de ${id}; consulta el estado antes de reintentar. La cuenta se conserva.`,
          503,
        );
      }
      if (current.phase === 'committed') return this.result(current);
      if (authCreationUncertain) {
        throw new AppError(
          `No se pudo determinar la creación de la cuenta de ${id}. Requiere reconciliación de Auth antes de reintentar; no se eliminó ninguna identidad.`,
          503,
        );
      }
      if (createdId) {
        const { error: de } = await this.db.auth.admin.deleteUser(createdId);
        if (de) {
          throw new AppError(
            `La programación no se confirmó y la compensación de ${id} necesita revisión administrativa.`,
            503,
          );
        }
      }
      const { error: reset } = await this.db
        .from('manual_enrollment_operations')
        .update({ phase: 'failed', student_id: null, student_created: false })
        .eq('id', id)
        .eq('worker_id', worker)
        .eq('phase', 'needs_review')
        .select('id')
        .single();
      if (reset)
        throw new AppError(`La operación ${id} necesita reconciliación antes de reintentar`, 503);
      throw error;
    }
  }
  private requireInstructor(plan: ManualPracticeInput): string {
    if (!plan.instructorId) throw new AppError('Selecciona un instructor antes de confirmar', 400);
    return plan.instructorId;
  }
  private async updateOperation(
    id: string,
    worker: string,
    fields: Database['public']['Tables']['manual_enrollment_operations']['Update'],
  ): Promise<void> {
    const { error } = await this.db
      .from('manual_enrollment_operations')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('worker_id', worker)
      .eq('phase', 'processing')
      .select('id')
      .single();
    if (error) throw error;
  }
  async resend(actor: string, id: string, regenerate: boolean): Promise<ManualEnrollmentResult> {
    await this.sendEmail(actor, id, undefined, regenerate).catch((error: unknown) => {
      if (error instanceof AppError) throw error;
    });
    return this.result(await this.operation(actor, id));
  }
  private async sendEmail(
    actor: string,
    id: string,
    password?: string,
    regenerate = false,
  ): Promise<void> {
    const op = await this.operation(actor, id);
    if (op.phase !== 'committed' || !op.student_id)
      throw new AppError('Solo se puede reenviar una matrícula confirmada', 409);
    const { data: profile, error: pe } = await this.db
      .from('users')
      .select('nombre_completo,debe_cambiar_password')
      .eq('id', op.student_id)
      .single();
    if (pe) throw pe;
    if (
      !password &&
      !regenerate &&
      op.student_created &&
      profile.debe_cambiar_password &&
      op.email_status !== 'sent'
    )
      throw new AppError(
        'Para reenviar el acceso de esta cuenta nueva debes confirmar explícitamente la regeneración de su contraseña temporal.',
        409,
      );
    if (regenerate && (!op.student_created || !profile.debe_cambiar_password))
      throw new AppError(
        'Solo puede regenerarse la contraseña temporal de una cuenta creada en esta operación que aún no la ha cambiado',
        409,
      );
    const { data: claimed, error: ce } = await this.db.rpc('claim_manual_enrollment_email', {
      p_id: id,
    });
    if (ce) throw ce;
    if (!claimed) {
      if (op.email_status === 'sending')
        throw new AppError('Envío en curso o resultado incierto. Revisar antes de reenviar.', 409);
      return;
    }
    let delivered = false;
    try {
      if (regenerate) {
        password = randomBytes(18).toString('base64url');
        const { error } = await this.db.auth.admin.updateUserById(op.student_id, { password });
        if (error) throw error;
      }
      const { data: auth, error } = await this.db.auth.admin.getUserById(op.student_id);
      if (error || !auth.user.email) throw error ?? new Error('Cuenta sin correo');
      const r = this.result(op);
      let cohortName: string | null = null;
      if (r.cohortId) {
        const { data, error: e } = await this.db
          .from('cohorts')
          .select('nombre')
          .eq('id', r.cohortId)
          .single();
        if (e) throw e;
        cohortName = data.nombre;
      }
      await this.email.sendManualEnrollmentEmail({
        to: auth.user.email,
        nombreCompleto: profile.nombre_completo,
        courseType: r.courseType,
        cohortName,
        status: r.status,
        studentCreated: r.studentCreated,
        temporaryPassword: password,
        days: Number(r.plan.dias),
        blocks: Number(r.plan.bloques),
        start: String(r.plan.fechaInicio),
        end: String(r.plan.fechaFinElegida),
      });
      delivered = true;
      const { error: e } = await this.db
        .from('manual_enrollment_operations')
        .update({ email_status: 'sent' })
        .eq('id', id)
        .eq('email_status', 'sending');
      if (e) throw e;
    } catch (error) {
      if (!delivered)
        await this.db
          .from('manual_enrollment_operations')
          .update({ email_status: 'failed' })
          .eq('id', id)
          .eq('email_status', 'sending');
      throw error;
    }
  }
}
