import { randomBytes } from 'node:crypto';

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../config/database.types';
import type { CreateEnrollmentInput, Enrollment } from '../models/enrollment.model';
import type { UserProfile } from '../models/user.model';
import { AppError } from '../utils/AppError';
import { isCupoExceededError, type CohortAssignmentService } from './cohortAssignment.service';
import type { EmailService } from './email.service';

type CohortRow = Database['public']['Tables']['cohorts']['Row'];
type EnrollmentRow = Database['public']['Tables']['enrollments']['Row'];
type UserRow = Database['public']['Tables']['users']['Row'];

const POSTGRES_UNIQUE_VIOLATION = '23505';
const AUTH_EMAIL_EXISTS = 'email_exists';

// Igual que en SolicitudService.crearEnrollmentConAsignacion: tope de
// reintentos ante una condición de carrera real por el último cupo de una
// cohorte (ver enforce_cohort_cupo, migración 014).
const MAX_INTENTOS_ASIGNACION_COHORTE = 5;

function toEnrollment(row: EnrollmentRow): Enrollment {
  return {
    id: row.id,
    studentId: row.student_id,
    cohortId: row.cohort_id,
    status: row.status,
    montoTotal: row.monto_total === null ? null : Number(row.monto_total),
    descuento: Number(row.descuento),
    montoAbonado: Number(row.monto_abonado),
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
    fechaNacimiento: row.fecha_nacimiento,
    tipoSangre: row.tipo_sangre,
    genero: row.genero,
    ciudadania: row.ciudadania,
    direccion: row.direccion,
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

// Resultado de aplicar el descuento (si lo hay) al precio de la cohorte, y
// de validar el abono contra ese total. Ver 017_enrollments_pago_inicial.sql.
interface PagoInicial {
  montoTotal: number;
  descuento: number;
  montoAbonado: number;
}

// RF-01: una sola operación crea la cuenta del estudiante en Supabase Auth,
// su fila en `users`, lo inscribe en la cohorte, y envía el correo de
// bienvenida. Si un paso falla después de crear el usuario en Auth, se
// compensa borrándolo (ver docs/adr/002 sobre esta decisión).
export class EnrollmentService {
  constructor(
    private readonly supabase: SupabaseClient<Database>,
    private readonly emailService: EmailService,
    private readonly cohortAssignmentService: CohortAssignmentService,
  ) {}

  async enrollStudent(input: CreateEnrollmentInput): Promise<EnrollStudentResult> {
    const cohortId = input.cohortId;

    // cohortId explícito: el admin sobreescribe la sugerencia, se valida de
    // una vez (fail-fast, antes de crear nada) igual que siempre. Sin
    // cohortId, la resolución (incluyendo el caso sin cohorte elegible) se
    // hace después de crear el usuario, igual que en la aprobación de
    // solicitudes online (ver crearEnrollmentConAsignacion).
    const cohort = cohortId !== undefined ? await this.getCohortOrThrow(cohortId) : null;
    const pagoInicial = cohort ? this.resolvePagoInicial(Number(cohort.precio), input) : null;
    await this.assertCedulaAvailable(input.cedula);

    const temporaryPassword = generateTemporaryPassword();
    const { data: authData, error: authError } = await this.supabase.auth.admin.createUser({
      email: input.correo,
      password: temporaryPassword,
      email_confirm: true,
      app_metadata: { role: 'estudiante' },
    });

    if (authError) {
      if (authError.code === AUTH_EMAIL_EXISTS) {
        throw new AppError('Ya existe un usuario registrado con este correo electrónico', 409);
      }
      throw authError;
    }

    const studentId = authData.user.id;

    try {
      const userRow = await this.createUserRow(studentId, input);
      const enrollmentRow =
        cohortId !== undefined && pagoInicial
          ? await this.createEnrollmentRow(studentId, cohortId, pagoInicial)
          : await this.createEnrollmentWithAutoAssignment(
              studentId,
              this.requireCourseId(input.courseId),
              input,
            );

      await this.sendWelcomeEmailSafely(input.correo, input.nombreCompleto, temporaryPassword);

      return { student: toUserProfile(userRow), enrollment: toEnrollment(enrollmentRow) };
    } catch (err) {
      await this.supabase.auth.admin.deleteUser(studentId).catch(() => undefined);
      throw err;
    }
  }

  // Reusa CohortAssignmentService (misma lógica que la aprobación de
  // solicitudes online) para el flujo de matrícula manual sin cohortId
  // explícito. Si ninguna cohorte del curso tiene matrícula abierta hoy,
  // crea igual la inscripción como 'pendiente_cohorte' (cohort_id y
  // monto_total null, ver migración 014) en vez de fallar.
  private async createEnrollmentWithAutoAssignment(
    studentId: string,
    courseId: string,
    input: CreateEnrollmentInput,
  ): Promise<EnrollmentRow> {
    const excluidas: string[] = [];

    for (let intento = 0; intento < MAX_INTENTOS_ASIGNACION_COHORTE; intento++) {
      const asignacion = await this.cohortAssignmentService.assignCohortForCourse(
        courseId,
        undefined,
        excluidas,
      );

      if (asignacion.cohortId === null) {
        return this.insertEnrollmentRow({
          student_id: studentId,
          cohort_id: null,
          course_id: courseId,
          status: 'pendiente_cohorte',
          monto_total: null,
        });
      }

      if (asignacion.precio === null) {
        // Invariante de CohortAssignmentService: precio solo es null junto
        // con cohortId null. Si esto se dispara hay una inconsistencia
        // real, no un caso de negocio (mismo criterio que otros 500 de
        // invariante en el proyecto, ver practiceSlotGeneration.service.ts).
        throw new AppError('La cohorte asignada no tiene precio definido', 500);
      }

      const pagoInicial = this.resolvePagoInicial(asignacion.precio, input);

      // Inserta sin traducir el error todavía: isCupoExceededError necesita
      // el código crudo de Postgres (CD001) para decidir si reintenta, y
      // insertEnrollmentRow ya lo traduce a AppError antes de propagarlo.
      const { data, error } = await this.supabase
        .from('enrollments')
        .insert({
          student_id: studentId,
          cohort_id: asignacion.cohortId,
          monto_total: pagoInicial.montoTotal,
          descuento: pagoInicial.descuento,
          monto_abonado: pagoInicial.montoAbonado,
        })
        .select()
        .single();

      if (!error) {
        return data;
      }
      if (isCupoExceededError(error)) {
        excluidas.push(asignacion.cohortId);
        continue;
      }
      throw this.translateEnrollmentInsertError(
        error,
        'El estudiante ya está activo en otra cohorte',
      );
    }

    // Se agotaron los reintentos (prácticamente imposible en la práctica,
    // ver MAX_INTENTOS_ASIGNACION_COHORTE): cae a pendiente de cohorte en
    // vez de fallar la matrícula completa.
    return this.insertEnrollmentRow({
      student_id: studentId,
      cohort_id: null,
      course_id: courseId,
      status: 'pendiente_cohorte',
      monto_total: null,
    });
  }

  // Defensa adicional a la validación de enrollment.routes.ts (cohortId o
  // courseId es obligatorio): si llegara sin ninguno de los dos, falla con
  // un 400 claro en vez de un TypeError críptico más abajo.
  private requireCourseId(courseId: string | undefined): string {
    if (courseId === undefined) {
      throw new AppError('courseId es obligatorio cuando no se envía cohortId', 400);
    }
    return courseId;
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
        debe_cambiar_password: true,
        fecha_nacimiento: input.fechaNacimiento ?? null,
        tipo_sangre: input.tipoSangre ?? null,
        genero: input.genero ?? null,
        ciudadania: input.ciudadania ?? null,
        direccion: input.direccion ?? null,
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
    pagoInicial: PagoInicial,
  ): Promise<EnrollmentRow> {
    return this.insertEnrollmentRow({
      student_id: studentId,
      cohort_id: cohortId,
      monto_total: pagoInicial.montoTotal,
      descuento: pagoInicial.descuento,
      monto_abonado: pagoInicial.montoAbonado,
    });
  }

  // Alcance mínimo (RF-06 futuro): solo el pago inicial al matricular, no
  // un historial de pagos por cuotas (eso es Kushki, aparte). descuento se
  // resta del precio de la cohorte; montoAbonado es lo que se registró
  // como pagado en ese momento (igual a montoTotal si "paga todo", menor
  // si "abona"). Valida ambas relaciones con un 400 claro en vez de dejar
  // que lo atrape el CHECK de la base de datos como un 500 genérico.
  private resolvePagoInicial(precio: number, input: CreateEnrollmentInput): PagoInicial {
    const descuento = input.descuento ?? 0;
    const montoTotal = precio - descuento;
    if (montoTotal < 0) {
      throw new AppError('El descuento no puede ser mayor al precio de la cohorte', 400);
    }

    const montoAbonado = input.montoAbonado ?? 0;
    if (montoAbonado > montoTotal) {
      throw new AppError('El monto abonado no puede ser mayor al monto total', 400);
    }

    return { montoTotal, descuento, montoAbonado };
  }

  private async insertEnrollmentRow(
    row: Database['public']['Tables']['enrollments']['Insert'],
  ): Promise<EnrollmentRow> {
    const { data, error } = await this.supabase.from('enrollments').insert(row).select().single();

    if (error) {
      throw this.translateEnrollmentInsertError(
        error,
        'El estudiante ya está activo en otra cohorte',
      );
    }

    return data;
  }

  private translateUniqueViolation(error: PostgrestError, message: string): Error {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) {
      return new AppError(message, 409);
    }
    return error;
  }

  private translateEnrollmentInsertError(error: PostgrestError, uniqueMessage: string): Error {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) {
      return new AppError(uniqueMessage, 409);
    }
    if (isCupoExceededError(error)) {
      return new AppError('La cohorte ya alcanzó su cupo máximo', 409);
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
