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
}
