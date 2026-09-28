import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../src/config/database.types';
import type { ConfirmarPracticaInput } from '../../src/models/practiceSlotGeneration.model';
import { PracticeSlotGenerationService } from '../../src/services/practiceSlotGeneration.service';
import { createChain, createSupabaseFromMock, type ChainResult } from '../helpers/supabaseMock';

const enrollmentId = 'enrollment-1';
const studentId = 'student-1';
const cohortId = 'cohort-1';
const courseId = 'course-1';

const enrollmentRow = { student_id: studentId, cohort_id: cohortId, status: 'activo' };
const cohortRow = { course_id: courseId };
const courseRow = { horas_requeridas: 15 };

function buildService(fromResults: ChainResult[]): PracticeSlotGenerationService {
  const supabase = {
    from: createSupabaseFromMock(fromResults),
  } as unknown as SupabaseClient<Database>;
  return new PracticeSlotGenerationService(supabase);
}

const baseInput = {
  fechaInicio: '2026-03-02', // lunes
  modalidad: 'entre_semana' as const,
  horasPorDia: 2,
  fechaFin: '2026-03-08', // domingo -> 5 días entre semana (02..06)
};

describe('PracticeSlotGenerationService.sugerir', () => {
  it('rechaza si horaDeseada + horasPorDia no cabe en 06:00-22:00, sin consultar la base', async () => {
    const service = buildService([]);

    await expect(
      service.sugerir(enrollmentId, { ...baseInput, horaDeseada: '21:00' }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rechaza si se envían fechaFin y numeroSesiones a la vez', async () => {
    const service = buildService([
      { data: enrollmentRow, error: null },
      { data: cohortRow, error: null },
      { data: courseRow, error: null },
    ]);

    await expect(
      service.sugerir(enrollmentId, {
        ...baseInput,
        numeroSesiones: 5,
        horaDeseada: '15:00',
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('responde 404 si la matrícula no existe', async () => {
    const service = buildService([{ data: null, error: null }]);

    await expect(
      service.sugerir(enrollmentId, { ...baseInput, horaDeseada: '15:00' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('responde 409 si la matrícula no está activa', async () => {
    const service = buildService([{ data: { ...enrollmentRow, status: 'retirado' }, error: null }]);

    await expect(
      service.sugerir(enrollmentId, { ...baseInput, horaDeseada: '15:00' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('modalidad entre_semana: calcula solo los 5 días hábiles del rango (lunes a domingo)', async () => {
    const service = buildService([
      { data: enrollmentRow, error: null },
      { data: cohortRow, error: null },
      { data: courseRow, error: null },
      { data: [{ id: 'ins-1', nombre_completo: 'Bruno Salas' }], error: null }, // instructores
      { data: [], error: null }, // nadie ocupado a las 15:00
    ]);

    const result = await service.sugerir(enrollmentId, {
      ...baseInput,
      horaDeseada: '15:00',
    });

    expect(result.fechas).toEqual([
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
      '2026-03-06',
    ]);
    expect(result.horaResuelta).toBe('15:00');
    expect(result.horaAjustada).toBe(false);
    expect(result.instructoresSugeridos).toEqual([{ id: 'ins-1', nombreCompleto: 'Bruno Salas' }]);
    expect(result.totalSesiones).toBe(5);
    expect(result.horasProgramadas).toBe(10); // 5 días x 2h
    expect(result.horasRequeridas).toBe(15);
  });

  it('modalidad fin_de_semana: calcula solo sábado y domingo del mismo rango', async () => {
    const service = buildService([
      { data: enrollmentRow, error: null },
      { data: cohortRow, error: null },
      { data: courseRow, error: null },
      { data: [{ id: 'ins-1', nombre_completo: 'Bruno Salas' }], error: null },
      { data: [], error: null },
    ]);

    const result = await service.sugerir(enrollmentId, {
      ...baseInput,
      modalidad: 'fin_de_semana',
      horaDeseada: '15:00',
    });

    expect(result.fechas).toEqual(['2026-03-07', '2026-03-08']);
    expect(result.totalSesiones).toBe(2);
  });

  it('numeroSesiones: cuenta N días hábiles en vez de usar fechaFin', async () => {
    const service = buildService([
      { data: enrollmentRow, error: null },
      { data: cohortRow, error: null },
      { data: courseRow, error: null },
      { data: [{ id: 'ins-1', nombre_completo: 'Bruno Salas' }], error: null },
      { data: [], error: null },
    ]);

    const result = await service.sugerir(enrollmentId, {
      fechaInicio: '2026-03-02',
      modalidad: 'entre_semana',
      horasPorDia: 1,
      numeroSesiones: 3,
      horaDeseada: '15:00',
    });

    expect(result.fechas).toEqual(['2026-03-02', '2026-03-03', '2026-03-04']);
    expect(result.totalSesiones).toBe(3);
  });

  it('si horaDeseada está ocupada, expande la búsqueda a horas adyacentes y marca horaAjustada', async () => {
    const service = buildService([
      { data: enrollmentRow, error: null },
      { data: cohortRow, error: null },
      { data: courseRow, error: null },
      // offset 0 (15:00): un instructor, pero ocupado
      { data: [{ id: 'ins-1', nombre_completo: 'Bruno Salas' }], error: null },
      { data: [{ instructor_id: 'ins-1' }], error: null },
      // offset -1 (14:00): mismo instructor, libre
      { data: [{ id: 'ins-1', nombre_completo: 'Bruno Salas' }], error: null },
      { data: [], error: null },
    ]);

    const result = await service.sugerir(enrollmentId, {
      ...baseInput,
      horaDeseada: '15:00',
    });

    expect(result.horaResuelta).toBe('14:00');
    expect(result.horaAjustada).toBe(true);
  });

  it('si ningún instructor está libre en ninguna hora del rango, responde 409', async () => {
    // 33 candidatas posibles (offset 0 a 16 en ambas direcciones), pero acá
    // basta con simular que TODAS devuelven cero instructores libres.
    const noInstructors: ChainResult[] = [];
    for (let i = 0; i < 33; i += 1) {
      noInstructors.push({ data: [], error: null }); // sin instructores registrados
    }
    const service = buildService([
      { data: enrollmentRow, error: null },
      { data: cohortRow, error: null },
      { data: courseRow, error: null },
      ...noInstructors,
    ]);

    await expect(
      service.sugerir(enrollmentId, { ...baseInput, horaDeseada: '15:00' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('PracticeSlotGenerationService.confirmar', () => {
  const confirmarInput = {
    ...baseInput,
    horaResuelta: '15:00',
    instructorId: 'ins-1',
  } as ConfirmarPracticaInput;

  it('recalcula las fechas de forma determinista, verifica disponibilidad e inserta en bloque', async () => {
    // 5 días x 2h/día (horasPorDia de baseInput) = 10 franjas.
    const insertChain = createChain({
      data: Array.from({ length: 10 }, (_, i) => ({ id: `slot-${String(i + 1)}` })),
      error: null,
    });
    // getEnrollmentContext + assertInstructorExists + assertInstructorFreeFor
    // + el insert final — cada uno con su propia respuesta, en orden.
    const from = jest
      .fn()
      .mockReturnValueOnce(createChain({ data: enrollmentRow, error: null }))
      .mockReturnValueOnce(createChain({ data: cohortRow, error: null }))
      .mockReturnValueOnce(createChain({ data: courseRow, error: null }))
      .mockReturnValueOnce(createChain({ data: { id: 'ins-1', rol: 'instructor' }, error: null }))
      .mockReturnValueOnce(createChain({ data: [], error: null }))
      .mockReturnValueOnce(insertChain);
    const service = new PracticeSlotGenerationService({
      from,
    } as unknown as SupabaseClient<Database>);

    const result = await service.confirmar(enrollmentId, confirmarInput);

    expect(result.slotsCreados).toBe(10);
    expect(result.horasProgramadas).toBe(10);
    expect(result.horasRequeridas).toBe(15);
    expect(result.slotIds).toHaveLength(10);

    const insertedRows = insertChain.insert.mock.calls[0][0] as Record<string, unknown>[];
    expect(insertedRows).toHaveLength(10);
    for (const row of insertedRows) {
      expect(row).toMatchObject({
        cohort_id: cohortId,
        instructor_id: 'ins-1',
        student_id: studentId,
        duration_minutes: 60,
        status: 'asignado',
      });
    }
    expect(insertedRows[0].scheduled_at).toBe('2026-03-02T20:00:00.000Z');
  });

  it('responde 404 si el instructor no existe', async () => {
    const service = buildService([
      { data: enrollmentRow, error: null },
      { data: cohortRow, error: null },
      { data: courseRow, error: null },
      { data: null, error: null },
    ]);

    await expect(service.confirmar(enrollmentId, confirmarInput)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('responde 400 si el usuario indicado no tiene rol instructor', async () => {
    const service = buildService([
      { data: enrollmentRow, error: null },
      { data: cohortRow, error: null },
      { data: courseRow, error: null },
      { data: { id: 'ins-1', rol: 'estudiante' }, error: null },
    ]);

    await expect(service.confirmar(enrollmentId, confirmarInput)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('responde 409 con la fecha/hora en conflicto si el instructor ya no está libre (chequeo previo)', async () => {
    const service = buildService([
      { data: enrollmentRow, error: null },
      { data: cohortRow, error: null },
      { data: courseRow, error: null },
      { data: { id: 'ins-1', rol: 'instructor' }, error: null },
      { data: [{ scheduled_at: '2026-03-02T20:00:00.000Z' }], error: null }, // ya ocupado
    ]);

    await expect(service.confirmar(enrollmentId, confirmarInput)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('2026-03-02 15:00') as string,
    });
  });

  it('si el índice único rechaza el insert (carrera justo antes de escribir), responde 409 sin insertar parcialmente', async () => {
    const from = jest
      .fn()
      .mockReturnValueOnce(createChain({ data: enrollmentRow, error: null }))
      .mockReturnValueOnce(createChain({ data: cohortRow, error: null }))
      .mockReturnValueOnce(createChain({ data: courseRow, error: null }))
      .mockReturnValueOnce(createChain({ data: { id: 'ins-1', rol: 'instructor' }, error: null }))
      .mockReturnValueOnce(createChain({ data: [], error: null }))
      .mockReturnValueOnce(
        createChain({
          data: null,
          error: {
            code: '23505',
            details:
              'Key (instructor_id, scheduled_at)=(ins-1, 2026-03-02 20:00:00+00) already exists.',
          },
        }),
      );
    const service = new PracticeSlotGenerationService({
      from,
    } as unknown as SupabaseClient<Database>);

    await expect(service.confirmar(enrollmentId, confirmarInput)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('2026-03-02 15:00') as string,
    });
  });
});
