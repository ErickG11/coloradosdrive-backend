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

export type UpdateCohortInput = Partial<CreateCohortInput>;
