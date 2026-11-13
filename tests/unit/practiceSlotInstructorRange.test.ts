import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../src/config/database.types';
import { PracticeSlotService } from '../../src/services/practiceSlot.service';
import { createChain } from '../helpers/supabaseMock';

const instructorId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const cohortId = '33333333-3333-4333-8333-333333333333';
const from = '2026-03-09T05:00:00.000Z';
const to = '2026-03-16T05:00:00.000Z';

function row(id: string, teacher: string, scheduledAt: string) {
  return {
    id, cohort_id: cohortId, instructor_id: teacher,
    student_id: null, scheduled_at: scheduledAt, duration_minutes: 60, status: 'disponible',
    confirmation_notified_at: null, release_notified_at: null, confirmed_at: null,
    attended: null, created_at: '', updated_at: '',
    instructor: { nombre_completo: 'Instructor', activo: true }, student: null,
  };
}

type InstructorRow = ReturnType<typeof row> & {
  cohort?: { nombre: string; course?: { tipo: 'A' | 'B' } | null } | null;
};

const expectedSlot = {
  id: 'at-from',
  cohortId,
  instructorId,
  studentId: null,
  scheduledAt: from,
  durationMinutes: 60,
  status: 'disponible',
  confirmationNotifiedAt: null,
  releaseNotifiedAt: null,
  confirmedAt: null,
  attended: null,
  createdAt: '',
  updatedAt: '',
  instructorName: 'Instructor',
  studentName: null,
};

const rows = [
  row('before', instructorId, '2026-03-09T04:59:59.999Z'),
  row('at-from', instructorId, from),
  row('inside', instructorId, '2026-03-16T04:59:59.999Z'),
  row('at-to', instructorId, to),
  row('other', otherId, '2026-03-10T15:00:00.000Z'),
];

function harness(inputRows: InstructorRow[] = rows) {
  const chain = createChain({ data: [], error: null });
  let selectedInstructor: string | undefined;
  let lower: string | undefined;
  let upper: string | undefined;
  chain.eq.mockImplementation((field: string, value: string) => {
    if (field === 'instructor_id') selectedInstructor = value;
    return chain;
  });
  chain.gte.mockImplementation((_field: string, value: string) => { lower = value; return chain; });
  chain.lt.mockImplementation((_field: string, value: string) => { upper = value; return chain; });
  chain.then = (resolve, reject) => Promise.resolve({
    data: inputRows.filter((item) => item.instructor_id === selectedInstructor &&
      (lower === undefined || item.scheduled_at >= lower) &&
      (upper === undefined || item.scheduled_at < upper)),
    error: null,
  }).then(resolve, reject);
  const fromMock = jest.fn().mockReturnValue(chain);
  const service = new PracticeSlotService({ from: fromMock } as unknown as SupabaseClient<Database>);
  return { chain, fromMock, service };
}

describe('PracticeSlotService.listSlotsForInstructor', () => {
  it('sin rango conserva el listado completo del instructor y el orden ascendente', async () => {
    const { chain, service } = harness();
    const result = await service.listSlotsForInstructor(instructorId);
    expect(result.map((slot) => slot.id)).toEqual(['before', 'at-from', 'inside', 'at-to']);
    expect(chain.gte).not.toHaveBeenCalled();
    expect(chain.lt).not.toHaveBeenCalled();
    expect(chain.order).toHaveBeenCalledWith('scheduled_at', { ascending: true });
  });

  it('incluye from, excluye to y omite las franjas del otro instructor', async () => {
    const { chain, service } = harness();
    const result = await service.listSlotsForInstructor(instructorId, { from, to });
    expect(result.map((slot) => slot.id)).toEqual(['at-from', 'inside']);
    expect(chain.eq).toHaveBeenCalledWith('instructor_id', instructorId);
    expect(chain.gte).toHaveBeenCalledWith('scheduled_at', from);
    expect(chain.lt).toHaveBeenCalledWith('scheduled_at', to);
  });

  it('devuelve A y B como campos planos y obtiene todas las relaciones en una sola consulta', async () => {
    const { chain, fromMock, service } = harness([
      {
        ...row('at-from', instructorId, from),
        cohort: { nombre: 'Cohorte de motos', course: { tipo: 'A' } },
      },
      {
        ...row('inside', instructorId, '2026-03-10T15:00:00.000Z'),
        cohort: { nombre: 'Cohorte de vehículos', course: { tipo: 'B' } },
      },
    ]);

    expect(await service.listSlotsForInstructor(instructorId, { from, to })).toEqual([
      { ...expectedSlot, courseType: 'A', cohortName: 'Cohorte de motos' },
      {
        ...expectedSlot,
        id: 'inside',
        scheduledAt: '2026-03-10T15:00:00.000Z',
        courseType: 'B',
        cohortName: 'Cohorte de vehículos',
      },
    ]);
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledWith('practice_slots');
    expect(chain.select).toHaveBeenCalledTimes(1);
    const selection = chain.select.mock.calls[0][0] as string;
    expect(selection).toContain('cohort:cohorts!practice_slots_cohort_id_fkey(');
    expect(selection).toContain('course:courses!cohorts_course_id_fkey(tipo)');
    expect(selection).not.toContain('!inner');
  });

  const missingRelations: {
    description: string;
    cohort: InstructorRow['cohort'];
    metadata: { cohortName?: string };
  }[] = [
    { description: 'cohorte ausente', cohort: undefined, metadata: {} },
    { description: 'cohorte nula', cohort: null, metadata: {} },
    {
      description: 'curso nulo',
      cohort: { nombre: 'Cohorte de prueba', course: null },
      metadata: { cohortName: 'Cohorte de prueba' },
    },
    {
      description: 'curso ausente',
      cohort: { nombre: 'Cohorte de prueba' },
      metadata: { cohortName: 'Cohorte de prueba' },
    },
  ];

  it.each(missingRelations)('con $description conserva la franja sin inventar campos', async ({
    cohort, metadata,
  }) => {
    const { service } = harness([{ ...row('at-from', instructorId, from), cohort }]);
    const result = await service.listSlotsForInstructor(instructorId);

    expect(result).toEqual([{ ...expectedSlot, ...metadata }]);
    expect(result[0]).not.toHaveProperty('courseType');
    if (cohort == null) expect(result[0]).not.toHaveProperty('cohortName');
  });
});

describe('compatibilidad de las respuestas de administrador y alumno', () => {
  // Aunque el mock incluya relaciones, los otros roles conservan su contrato plano anterior.
  const freeRow = {
    ...row('at-from', instructorId, from),
    cohort: { nombre: 'Cohorte de prueba', course: { tipo: 'B' } },
  };
  const ownRow = {
    ...freeRow,
    id: 'own-slot',
    student_id: otherId,
    student: { nombre_completo: 'Alumno de prueba' },
    status: 'completado',
    attended: true,
  };
  const expectedOwnSlot = {
    ...expectedSlot,
    id: 'own-slot',
    studentId: otherId,
    studentName: 'Alumno de prueba',
    status: 'completado',
    attended: true,
  };

  it('administrador conserva exactamente los nombres y colorSemana, sin metadatos nuevos', async () => {
    const chain = createChain({ data: [freeRow, ownRow], error: null });
    const fromMock = jest.fn().mockReturnValue(chain);
    const service = new PracticeSlotService({ from: fromMock } as unknown as SupabaseClient<Database>);

    expect(await service.listSlotsForAdmin({})).toEqual([
      { ...expectedSlot, colorSemana: 'verde' },
      { ...expectedOwnSlot, colorSemana: 'verde' },
    ]);
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(chain.select.mock.calls[0][0]).not.toMatch(/\b(cohort|course):/);
  });

  it('alumno conserva la identidad oculta en franjas libres y los nombres en sus propias franjas', async () => {
    const freeChain = createChain({ data: [freeRow], error: null });
    const ownChain = createChain({ data: [ownRow], error: null });
    const fromMock = jest.fn()
      .mockReturnValueOnce(createChain({
        data: [{ id: 'enrollment', cohort_id: cohortId }], error: null,
      }))
      .mockReturnValueOnce(createChain({
        data: { enabled: false, implemented: true }, error: null,
      }))
      .mockReturnValueOnce(freeChain)
      .mockReturnValueOnce(ownChain);
    const service = new PracticeSlotService({ from: fromMock } as unknown as SupabaseClient<Database>);

    expect(await service.listSlotsForStudent(otherId)).toEqual([
      {
        id: 'at-from',
        cohortId,
        studentId: null,
        scheduledAt: from,
        durationMinutes: 60,
        status: 'disponible',
        confirmationNotifiedAt: null,
        releaseNotifiedAt: null,
        confirmedAt: null,
        attended: null,
        createdAt: '',
        updatedAt: '',
        studentName: null,
      },
      expectedOwnSlot,
    ]);
    expect(fromMock.mock.calls).toEqual([
      ['enrollments'], ['enrollment_rule_flags'], ['practice_slots'], ['practice_slots'],
    ]);
    expect(freeChain.select.mock.calls[0][0]).not.toMatch(/\b(cohort|course):/);
    expect(ownChain.select.mock.calls[0][0]).not.toMatch(/\b(cohort|course):/);
  });
});
