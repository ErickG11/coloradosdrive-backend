export const ENROLLMENT_STATUSES = ['activo', 'finalizado', 'retirado'] as const;

export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export interface Enrollment {
  id: string;
  studentId: string;
  cohortId: string;
  status: EnrollmentStatus;
  montoTotal: number;
  fechaInscripcion: string;
  createdAt: string;
  updatedAt: string;
}

// Datos de entrada del endpoint de matrícula: RF-01 los describe como una
// sola entrada (datos del estudiante + cohorte), de ahí que cree la cuenta
// del estudiante y la inscripción en una sola operación.
export interface CreateEnrollmentInput {
  cedula: string;
  nombreCompleto: string;
  correo: string;
  telefono?: string;
  cohortId: string;
}
