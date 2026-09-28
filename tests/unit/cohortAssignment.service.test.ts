import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../src/config/database.types';
import type { CandidateCohort } from '../../src/models/cohortAssignment.model';
import { assignCohort, CohortAssignmentService } from '../../src/services/cohortAssignment.service';
import { createSupabaseFromMock, type ChainResult } from '../helpers/supabaseMock';

const day = (value: string): Date => new Date(`${value}T00:00:00Z`);

function buildCandidate(overrides: Partial<CandidateCohort> = {}): CandidateCohort {
  return {
    id: 'cohort-1',
    fechaInicioMatricula: day('2026-01-01'),
    fechaFinMatricula: day('2026-01-31'),
    fechaInicioCurso: day('2026-02-01'),
    cupoMaximo: 20,
    cupoOcupado: 0,
    createdAt: day('2025-12-01'),
    precio: 150,
    ...overrides,
  };
}

describe('assignCohort (función pura)', () => {
  it('asigna la única candidata elegible', () => {
    const result = assignCohort(day('2026-01-15'), [buildCandidate()]);
    expect(result).toEqual({ cohortId: 'cohort-1', warning: null });
  });

  it('no elige una cohorte cuya matrícula todavía no abre', () => {
    const candidate = buildCandidate({ fechaInicioMatricula: day('2026-02-01') });
    const result = assignCohort(day('2026-01-15'), [candidate]);
    expect(result).toEqual({ cohortId: null });
  });

  it('no elige una cohorte cuya matrícula ya cerró', () => {
    const candidate = buildCandidate({ fechaFinMatricula: day('2026-01-10') });
    const result = assignCohort(day('2026-01-15'), [candidate]);
    expect(result).toEqual({ cohortId: null });
  });

  it('el límite de la ventana es inclusive: today === fechaInicioMatricula', () => {
    const candidate = buildCandidate({ fechaInicioMatricula: day('2026-01-15') });
    const result = assignCohort(day('2026-01-15'), [candidate]);
    expect(result.cohortId).toBe('cohort-1');
  });

  it('el límite de la ventana es inclusive: today === fechaFinMatricula', () => {
    const candidate = buildCandidate({ fechaFinMatricula: day('2026-01-15') });
    const result = assignCohort(day('2026-01-15'), [candidate]);
    expect(result.cohortId).toBe('cohort-1');
  });

  it('no elige una cohorte con el cupo exactamente lleno', () => {
    const candidate = buildCandidate({ cupoMaximo: 20, cupoOcupado: 20 });
    const result = assignCohort(day('2026-01-15'), [candidate]);
    expect(result).toEqual({ cohortId: null });
  });

  it('sí elige una cohorte con exactamente un cupo libre', () => {
    const candidate = buildCandidate({ cupoMaximo: 20, cupoOcupado: 19 });
    const result = assignCohort(day('2026-01-15'), [candidate]);
    expect(result.cohortId).toBe('cohort-1');
  });

  it('sin ninguna candidata elegible, retorna cohortId: null sin lanzar error', () => {
    const candidates = [
      buildCandidate({ id: 'a', fechaFinMatricula: day('2026-01-01') }), // ya cerró
      buildCandidate({ id: 'b', cupoOcupado: 20 }), // sin cupo
    ];
    expect(() => assignCohort(day('2026-01-15'), candidates)).not.toThrow();
    expect(assignCohort(day('2026-01-15'), candidates)).toEqual({ cohortId: null });
  });

  it('desempata por fecha_inicio_curso más próxima', () => {
    const candidates = [
      buildCandidate({ id: 'lejos', fechaInicioCurso: day('2026-06-01') }),
      buildCandidate({ id: 'cerca', fechaInicioCurso: day('2026-02-01') }),
    ];
    const result = assignCohort(day('2026-01-15'), candidates);
    expect(result.cohortId).toBe('cerca');
  });

  it('si empata fecha_inicio_curso, desempata por createdAt ascendente', () => {
    const candidates = [
      buildCandidate({
        id: 'mas-nueva',
        fechaInicioCurso: day('2026-02-01'),
        createdAt: day('2025-12-15'),
      }),
      buildCandidate({
        id: 'mas-vieja',
        fechaInicioCurso: day('2026-02-01'),
        createdAt: day('2025-12-01'),
      }),
    ];
    const result = assignCohort(day('2026-01-15'), candidates);
    expect(result.cohortId).toBe('mas-vieja');
  });

  it('advierte matricula_por_cerrar cuando quedan exactamente 3 días (umbral por defecto)', () => {
    const candidate = buildCandidate({ fechaFinMatricula: day('2026-01-18') });
    const result = assignCohort(day('2026-01-15'), [candidate]);
    expect(result).toEqual({ cohortId: 'cohort-1', warning: 'matricula_por_cerrar' });
  });

  it('no advierte cuando quedan 4 días (justo fuera del umbral por defecto)', () => {
    const candidate = buildCandidate({ fechaFinMatricula: day('2026-01-19') });
    const result = assignCohort(day('2026-01-15'), [candidate]);
    expect(result).toEqual({ cohortId: 'cohort-1', warning: null });
  });

  it('sin gap mínimo: asigna igual aunque la matrícula cierre HOY mismo', () => {
    const candidate = buildCandidate({ fechaFinMatricula: day('2026-01-15') });
    const result = assignCohort(day('2026-01-15'), [candidate]);
    expect(result).toEqual({ cohortId: 'cohort-1', warning: 'matricula_por_cerrar' });
  });

  it('respeta un warningThresholdDays personalizado', () => {
    const candidate = buildCandidate({ fechaFinMatricula: day('2026-01-22') });
    const result = assignCohort(day('2026-01-15'), [candidate], 7);
    expect(result).toEqual({ cohortId: 'cohort-1', warning: 'matricula_por_cerrar' });
  });
});

describe('CohortAssignmentService (wrapper con base de datos)', () => {
  function buildCohortRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'cohort-1',
      precio: '150.00',
      cupo_maximo: 20,
      fecha_inicio_matricula: '2026-01-01',
      fecha_fin_matricula: '2026-01-31',
      fecha_inicio_curso: '2026-02-01',
      created_at: '2025-12-01T00:00:00Z',
      ...overrides,
    };
  }

  function buildService(results: ChainResult[]): CohortAssignmentService {
    const supabase = { from: createSupabaseFromMock(results) } as unknown as SupabaseClient<Database>;
    return new CohortAssignmentService(supabase);
  }

  it('sin cohortes del curso, retorna pendiente sin consultar ocupación', async () => {
    const service = buildService([{ data: [], error: null }]);

    const result = await service.assignCohortForCourse('course-1', day('2026-01-15'));

    expect(result).toEqual({ cohortId: null, warning: null, precio: null });
  });

  it('asigna la cohorte elegible y devuelve su precio', async () => {
    const service = buildService([
      { data: [buildCohortRow()], error: null }, // cohorts
      { data: [], error: null }, // enrollments activos (0 ocupados)
    ]);

    const result = await service.assignCohortForCourse('course-1', day('2026-01-15'));

    expect(result).toEqual({ cohortId: 'cohort-1', warning: null, precio: 150 });
  });

  it('cuenta la ocupación real desde enrollments y descarta la cohorte si ya está llena', async () => {
    const service = buildService([
      { data: [buildCohortRow({ cupo_maximo: 1 })], error: null },
      { data: [{ cohort_id: 'cohort-1' }], error: null }, // 1 activo -> cupo lleno
    ]);

    const result = await service.assignCohortForCourse('course-1', day('2026-01-15'));

    expect(result).toEqual({ cohortId: null, warning: null, precio: null });
  });

  it('excluye las cohortes indicadas en excludeCohortIds (reintento tras condición de carrera)', async () => {
    const service = buildService([
      {
        data: [buildCohortRow({ id: 'llena' }), buildCohortRow({ id: 'con-cupo' })],
        error: null,
      },
      { data: [], error: null }, // ocupación de la única candidata que queda tras excluir
    ]);

    const result = await service.assignCohortForCourse('course-1', day('2026-01-15'), ['llena']);

    expect(result.cohortId).toBe('con-cupo');
  });
});
