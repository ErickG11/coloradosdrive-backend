export interface Cohort {
  id: string;
  courseId: string;
  nombre: string;
  precio: number;
  cupoMaximo: number;
  fechaInicioMatricula: string;
  fechaFinMatricula: string;
  fechaInicioCurso: string;
  fechaFinCurso: string;
  tipoModalidad: string | null;
  horariosCapacitacionTeoria: string | null;
  numeroVehiculos: number | null;
  numeroAulas: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCohortInput {
  courseId: string;
  nombre: string;
  precio: number;
  cupoMaximo: number;
  fechaInicioMatricula: string;
  fechaFinMatricula: string;
  fechaInicioCurso: string;
  fechaFinCurso: string;
  tipoModalidad?: string | null;
  horariosCapacitacionTeoria?: string | null;
  numeroVehiculos?: number | null;
  numeroAulas?: number | null;
}

// `updatedAt` es la versión base (el `updatedAt` que devolvió el GET, como
// cadena exacta): el PATCH solo se aplica si la cohorte no cambió desde entonces.
export type UpdateCohortInput = Partial<CreateCohortInput> & { updatedAt: string };

// Matrículas asociadas a la cohorte, por estado (pendiente_cohorte nunca
// tiene cohorte). `activos` es el mismo criterio de ocupación que el trigger
// enforce_cohort_cupo.
export interface CohortStudentCounts {
  total: number;
  activos: number;
  finalizados: number;
  retirados: number;
}

export interface CohortDetail extends Cohort {
  alumnos: CohortStudentCounts;
}

export interface CohortDeletionResult {
  id: string;
  nombre: string;
  message: string;
}
