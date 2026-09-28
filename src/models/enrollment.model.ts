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
// la cuenta del estudiante y la inscripción en una sola operación. A
// diferencia de la aprobación de solicitudes online (que puede terminar
// en 'pendiente_cohorte' vía asignación automática), este endpoint sigue
// exigiendo una cohorte explícita: el admin la elige a mano.
export interface CreateEnrollmentInput {
  cedula: string;
  nombreCompleto: string;
  correo: string;
  telefono?: string;
  cohortId: string;
}
