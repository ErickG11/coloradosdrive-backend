import type { AssignmentWarning } from './cohortAssignment.model';

export interface StudentCohortOptions {
  enrollmentId: string;
  courseId: string;
  suggestion: { cohortId: string | null; warning?: AssignmentWarning | null };
  items: {
    id: string;
    nombre: string | null;
    precio: number;
    cuposDisponibles: number;
    fechaInicioMatricula: string;
    fechaFinMatricula: string;
    fechaInicioCurso: string;
  }[];
}

export interface StudentCohortResult extends Record<string, unknown> {
  enrollmentId: string;
  cohortId: string;
  status: 'activo';
  montoTotal: number;
  descuento: number;
  montoAbonado: number;
  saldo: number;
  updatedAt: string;
}
