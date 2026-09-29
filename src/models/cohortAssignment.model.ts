// Candidata a asignación automática: una cohorte del curso al que aplica
// el postulante, con su ventana de matrícula/curso y ocupación actual.
// cupoOcupado SIEMPRE debe venir de un conteo fresco contra la base (nunca
// cacheado) — es responsabilidad del caller, no de assignCohort.
export interface CandidateCohort {
  id: string;
  fechaInicioMatricula: Date;
  fechaFinMatricula: Date;
  fechaInicioCurso: Date;
  cupoMaximo: number;
  cupoOcupado: number;
  createdAt: Date;
  precio: number;
  // Opcional: assignCohort (función pura) nunca la lee, solo la usa el
  // wrapper con DB para exponer el nombre de la cohorte ganadora (p. ej.
  // en la previsualización de asignación para matrícula manual).
  nombre?: string;
}

export type AssignmentWarning = 'matricula_por_cerrar';

// Sin cohorte elegible, el postulante queda pendiente de cohorte: no es un
// error, es un resultado válido (el admin la asignará manualmente después).
export type AssignmentResult =
  | { cohortId: string; warning: AssignmentWarning | null }
  | { cohortId: null };
