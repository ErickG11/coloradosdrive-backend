// 'pendiente_cohorte': inscripción aprobada pero sin cohorte asignada
// (ninguna cohorte del curso tenía matrícula abierta al momento de la
// asignación automática). Nunca tiene cohortId ni montoTotal (ver
// enrollments_pendiente_cohorte_shape en la base de datos).
export const ENROLLMENT_STATUSES = [
  'activo',
  'finalizado',
  'retirado',
  'pendiente_cohorte',
] as const;

export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export interface Enrollment {
  id: string;
  studentId: string;
  cohortId: string | null;
  status: EnrollmentStatus;
  montoTotal: number | null;
  // Pago inicial al matricular (ver 017_enrollments_pago_inicial.sql):
  // base para un futuro módulo de estado de cuenta, no un historial de
  // pagos en sí. Siempre presentes (default 0 en base de datos), incluso
  // cuando montoTotal es null (pendiente_cohorte).
  descuento: number;
  montoAbonado: number;
  fechaInscripcion: string;
  createdAt: string;
  updatedAt: string;
}

// Datos de entrada del endpoint de matrícula manual: RF-01 los describe
// como una sola entrada (datos del estudiante + cohorte), de ahí que cree
// la cuenta del estudiante y la inscripción en una sola operación.
//
// Fase 10: cohortId ahora es opcional, para reusar CohortAssignmentService
// (la misma asignación automática de la aprobación de solicitudes online)
// también en la matrícula manual. Si se manda cohortId, el admin está
// sobreescribiendo la sugerencia y se usa tal cual. Si no, courseId es
// obligatorio: se usa para correr assignCohort contra las cohortes de ese
// curso, con el mismo desenlace 'pendiente_cohorte' si ninguna aplica (ver
// EnrollmentService.enrollStudent). La validación de "al menos uno de los
// dos" vive en enrollment.routes.ts.
export interface CreateEnrollmentInput {
  cedula: string;
  nombreCompleto: string;
  correo: string;
  telefono?: string;
  cohortId?: string;
  courseId?: string;
  // Datos ampliados del estudiante (ver 016_users_datos_estudiante_ampliados.sql):
  // los 5 son opcionales, ninguno bloquea la matrícula si no se manda.
  fechaNacimiento?: string;
  tipoSangre?: string;
  genero?: string;
  ciudadania?: string;
  direccion?: string;
  // Pago inicial (ver 017_enrollments_pago_inicial.sql): ambos opcionales,
  // default 0 (sin descuento, nada abonado todavía). Solo se aplican
  // cuando la matrícula queda con cohorte asignada (con montoTotal real);
  // si queda pendiente_cohorte, se ignoran — ver EnrollmentService.
  descuento?: number;
  montoAbonado?: number;
}
