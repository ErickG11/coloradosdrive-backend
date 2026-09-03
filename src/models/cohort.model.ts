export interface Cohort {
  id: string;
  courseId: string;
  nombre: string;
  precio: number;
  cupoMaximo: number;
  fechaInicio: string;
  fechaFin: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCohortInput {
  courseId: string;
  nombre: string;
  precio: number;
  cupoMaximo: number;
  fechaInicio: string;
  fechaFin: string;
}

export type UpdateCohortInput = Partial<CreateCohortInput>;
