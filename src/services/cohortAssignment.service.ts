import type { SupabaseClient } from '@supabase/supabase-js';
import { DateTime } from 'luxon';

import type { Database } from '../config/database.types';
import type {
  AssignmentResult,
  AssignmentWarning,
  CandidateCohort,
} from '../models/cohortAssignment.model';
import { parseFechaCivil, SCHOOL_TIMEZONE } from '../utils/schoolTimezone';

const MS_PER_DAY = 86_400_000;
const DEFAULT_WARNING_THRESHOLD_DAYS = 3;

// Código de error propio (SQLSTATE de 5 caracteres, no colisiona con
// ningún código estándar de Postgres) que enforce_cohort_cupo() (ver
// migración 014) usa al rechazar un INSERT/UPDATE que superaría
// cupo_maximo. Los callers lo usan para traducir el error de Postgres a
// un 409 claro, y para reintentar la asignación excluyendo esa cohorte.
export const COHORT_CUPO_EXCEEDED_ERRCODE = 'CD001';

export function isCupoExceededError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === COHORT_CUPO_EXCEEDED_ERRCODE
  );
}

// ---------------------------------------------------------------------
// Función pura: dado "hoy" y una lista de cohortes candidatas (ya
// filtradas por curso, con su ocupación actual), decide a cuál asignar al
// postulante. Sin I/O, fácil de testear exhaustivamente sin mockear nada.
// ---------------------------------------------------------------------
export function assignCohort(
  today: Date,
  candidates: CandidateCohort[],
  warningThresholdDays: number = DEFAULT_WARNING_THRESHOLD_DAYS,
): AssignmentResult {
  const eligible = candidates.filter(
    (c) =>
      today.getTime() >= c.fechaInicioMatricula.getTime() &&
      today.getTime() <= c.fechaFinMatricula.getTime() &&
      c.cupoOcupado < c.cupoMaximo,
  );

  if (eligible.length === 0) {
    return { cohortId: null };
  }

  // Desempate: fecha_inicio_curso más próxima primero; si empatan
  // también en eso, createdAt ascendente (determinista, evita repartir
  // arbitrariamente entre cohortes candidatas idénticas).
  eligible.sort((a, b) => {
    const porFechaCurso = a.fechaInicioCurso.getTime() - b.fechaInicioCurso.getTime();
    if (porFechaCurso !== 0) {
      return porFechaCurso;
    }
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  const winner = eligible[0];
  // Sin ningún margen mínimo que bloquee la asignación: se asigna la
  // primera elegible sin importar cuán cerca esté del cierre. El warning
  // es puramente informativo.
  const diasParaCierre = Math.ceil(
    (winner.fechaFinMatricula.getTime() - today.getTime()) / MS_PER_DAY,
  );

  return {
    cohortId: winner.id,
    warning: diasParaCierre <= warningThresholdDays ? 'matricula_por_cerrar' : null,
  };
}

// ---------------------------------------------------------------------
// Wrapper con acceso a base de datos: obtiene las candidatas reales de un
// curso (con su ocupación actual, SIEMPRE fresca) y aplica assignCohort.
// Punto único de entrada reutilizable: tanto la aprobación de solicitudes
// online como (a futuro) el wizard de matriculación manual del admin
// importan este service en vez de reimplementar la consulta.
// ---------------------------------------------------------------------
export interface AssignCohortForCourseResult {
  cohortId: string | null;
  warning: AssignmentWarning | null;
  // Precio de la cohorte asignada (para copiarlo a enrollments.monto_total
  // al crear la inscripción); null cuando cohortId es null.
  precio: number | null;
}

type CohortCandidateRow = Pick<
  Database['public']['Tables']['cohorts']['Row'],
  | 'id'
  | 'precio'
  | 'cupo_maximo'
  | 'fecha_inicio_matricula'
  | 'fecha_fin_matricula'
  | 'fecha_inicio_curso'
  | 'created_at'
>;

export class CohortAssignmentService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async assignCohortForCourse(
    courseId: string,
    today: Date = schoolToday(),
    excludeCohortIds: readonly string[] = [],
  ): Promise<AssignCohortForCourseResult> {
    const candidates = await this.fetchCandidates(courseId, excludeCohortIds);
    const result = assignCohort(today, candidates);

    if (result.cohortId === null) {
      return { cohortId: null, warning: null, precio: null };
    }

    const winner = candidates.find((c) => c.id === result.cohortId);
    return {
      cohortId: result.cohortId,
      warning: result.warning,
      precio: winner ? winner.precio : null,
    };
  }

  private async fetchCandidates(
    courseId: string,
    excludeCohortIds: readonly string[],
  ): Promise<CandidateCohort[]> {
    const { data, error } = await this.supabase
      .from('cohorts')
      .select(
        'id, precio, cupo_maximo, fecha_inicio_matricula, fecha_fin_matricula, fecha_inicio_curso, created_at',
      )
      .eq('course_id', courseId);
    if (error) {
      throw error;
    }

    const excluded = new Set(excludeCohortIds);
    const cohortRows = (data as CohortCandidateRow[]).filter((row) => !excluded.has(row.id));
    if (cohortRows.length === 0) {
      return [];
    }

    const ocupados = await this.countOcupadosPorCohorte(cohortRows.map((c) => c.id));

    return cohortRows.map((row) => ({
      id: row.id,
      precio: Number(row.precio),
      cupoMaximo: row.cupo_maximo,
      cupoOcupado: ocupados.get(row.id) ?? 0,
      fechaInicioMatricula: parseFechaCivil(row.fecha_inicio_matricula).toJSDate(),
      fechaFinMatricula: parseFechaCivil(row.fecha_fin_matricula).toJSDate(),
      fechaInicioCurso: parseFechaCivil(row.fecha_inicio_curso).toJSDate(),
      createdAt: new Date(row.created_at),
    }));
  }

  private async countOcupadosPorCohorte(cohortIds: string[]): Promise<Map<string, number>> {
    const { data, error } = await this.supabase
      .from('enrollments')
      .select('cohort_id')
      .in('cohort_id', cohortIds)
      .eq('status', 'activo');
    if (error) {
      throw error;
    }

    const counts = new Map<string, number>();
    for (const row of data) {
      if (row.cohort_id === null) {
        continue;
      }
      counts.set(row.cohort_id, (counts.get(row.cohort_id) ?? 0) + 1);
    }
    return counts;
  }
}

// "Hoy" como el día civil ACTUAL en la zona horaria de la escuela, no el
// instante UTC crudo: sin esto, comparar contra fechas de matrícula/curso
// (parseadas también en SCHOOL_TIMEZONE vía parseFechaCivil) correría el
// riesgo de un desfase de un día cerca de la medianoche — Ecuador es
// UTC-5, así que la segunda mitad de cada día civil local cae en el día
// siguiente en UTC.
function schoolToday(): Date {
  return DateTime.now().setZone(SCHOOL_TIMEZONE).startOf('day').toJSDate();
}
