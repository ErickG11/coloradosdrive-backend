import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import type { ConfirmarPracticaInput, SugerirPracticaInput } from '../../src/models/practiceSlotGeneration.model';
import { PracticeSlotGenerationService } from '../../src/services/practiceSlotGeneration.service';
import { createChain, createSupabaseFromMock, type ChainResult } from '../helpers/supabaseMock';

const enrollmentId = 'enrollment-1';
const enrollment = { student_id: 'student-1', cohort_id: 'cohort-1', status: 'activo' };
const context: ChainResult[] = [
  { data: enrollment, error: null },
  { data: { course_id: 'course-1' }, error: null },
  { data: { horas_requeridas: 15 }, error: null },
];
const free = [{ id: 'ins-1', nombre_completo: 'Instructor de prueba' }];
const input = {
  fechaInicio: '2026-03-02', fechaFin: '2026-03-08',
  modalidad: 'entre_semana' as const, horasPorDia: 2, horaDeseada: '15:00',
};
const confirmation = { ...input, horaResuelta: '15:00', instructorId: 'ins-1' };
function harness(results = context, rpc = jest.fn().mockResolvedValue({ data: free, error: null })) {
  const from = createSupabaseFromMock(results);
  const service = new PracticeSlotGenerationService({ from, rpc } as unknown as SupabaseClient<Database>);
  return { service, from, rpc };
}

describe('PracticeSlotGenerationService', () => {
  it('el generador valida duración también cuando se llama sin HTTP', async () => {
    const { service, from, rpc } = harness([]);
    await expect(service.sugerir(enrollmentId, { ...input, durationMinutes: 45 } as unknown as SugerirPracticaInput))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(service.confirmar(enrollmentId, { ...confirmation, durationMinutes: 90 } as unknown as ConfirmarPracticaInput))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('rechaza un horario fuera de 06:00–22:00 antes de consultar', async () => {
    const { service, from, rpc } = harness([]);
    await expect(service.sugerir(enrollmentId, { ...input, horaDeseada: '21:00' }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rechaza fechaFin y numeroSesiones simultáneos', async () => {
    await expect(harness().service.sugerir(enrollmentId, { ...input, numeroSesiones: 5 }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('rechaza la ausencia de fechaFin y numeroSesiones', async () => {
    const { fechaFin: _fechaFin, ...withoutEnd } = input;
    await expect(harness().service.sugerir(enrollmentId, withoutEnd))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it.each([
    [null, 404], [{ ...enrollment, status: 'retirado' }, 409],
  ])('rechaza matrícula ausente o inactiva (%s)', async (row, status) => {
    await expect(harness([{ data: row, error: null }]).service.sugerir(enrollmentId, input))
      .rejects.toMatchObject({ statusCode: status });
  });

  it('cuenta días L–V y pasa cada bloque UTC a la disponibilidad de PostgreSQL', async () => {
    const { service, from, rpc } = harness();
    const result = await service.sugerir(enrollmentId, input);
    expect(result.fechas).toEqual(['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06']);
    expect(result).toMatchObject({
      horaResuelta: '15:00', horaAjustada: false, totalSesiones: 5, horasProgramadas: 10, horasRequeridas: 15,
      instructoresSugeridos: [{ id: 'ins-1', nombreCompleto: 'Instructor de prueba' }],
    });
    const starts = rpc.mock.calls[0][1].p_scheduled_ats as string[];
    expect(starts).toHaveLength(10);
    expect(starts.slice(0, 2)).toEqual(['2026-03-02T20:00:00.000Z', '2026-03-02T21:00:00.000Z']);
    expect(from).toHaveBeenCalledTimes(3); // Solo contexto; sugerir no escribe.
  });

  it('cuenta solo S–D en modalidad fin de semana', async () => {
    const result = await harness().service.sugerir(enrollmentId, { ...input, modalidad: 'fin_de_semana' });
    expect(result.fechas).toEqual(['2026-03-07', '2026-03-08']);
    expect(result.totalSesiones).toBe(2);
  });

  it('numeroSesiones cuenta N días de sesión', async () => {
    const { fechaFin: _fechaFin, ...withoutEnd } = input;
    const result = await harness().service.sugerir(enrollmentId, { ...withoutEnd, numeroSesiones: 3 });
    expect(result.fechas).toEqual(['2026-03-02', '2026-03-03', '2026-03-04']);
    expect(result.totalSesiones).toBe(3);
  });

  it('expande a una hora adyacente si la RPC informa conflicto', async () => {
    const rpc = jest.fn().mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: free, error: null });
    const result = await harness(context, rpc).service.sugerir(enrollmentId, input);
    expect(result).toMatchObject({ horaResuelta: '14:00', horaAjustada: true });
  });

  it('responde 409 cuando no hay instructor libre en ninguna candidata', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [], error: null });
    await expect(harness(context, rpc).service.sugerir(enrollmentId, input))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(rpc).toHaveBeenCalled();
  });

  it.each([
    [null, 404], [{ id: 'ins-1', rol: 'estudiante' }, 400],
  ])('valida existencia y rol del instructor (%s)', async (row, status) => {
    await expect(harness([...context, { data: row, error: null }]).service.confirmar(enrollmentId, confirmation))
      .rejects.toMatchObject({ statusCode: status });
  });

  it('recalcula y escribe el bloque completo de 10 franjas de 60 minutos', async () => {
    const insert = createChain({ data: Array.from({ length: 10 }, (_, id) => ({ id: String(id) })), error: null });
    const { service, from, rpc } = harness([...context, { data: { id: 'ins-1', rol: 'instructor', activo: true }, error: null }]);
    from.mockReturnValueOnce(insert);
    const result = await service.confirmar(enrollmentId, confirmation);
    expect(result).toMatchObject({ slotsCreados: 10, horasProgramadas: 10, horasRequeridas: 15 });
    expect(result.slotIds).toHaveLength(10);
    const rows = insert.insert.mock.calls[0][0] as Record<string, unknown>[];
    expect(rows).toHaveLength(10);
    expect(new Set(rows.map((row) => row.scheduled_at)).size).toBe(10);
    for (const row of rows) {
      expect(row).toMatchObject({ cohort_id: 'cohort-1', student_id: 'student-1',
        instructor_id: 'ins-1', duration_minutes: 60, status: 'asignado' });
    }
    expect(rpc).toHaveBeenCalledWith('practice_free_instructors', {
      p_instructor_id: 'ins-1', p_scheduled_ats: rows.map((row) => row.scheduled_at),
    });
    expect(insert.insert).toHaveBeenCalledTimes(1);
  });

  it('un conflicto previo evita el INSERT, incluida la ocupación de liberado resuelta por SQL', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [], error: null });
    const { service, from } = harness([...context, { data: { id: 'ins-1', rol: 'instructor', activo: true }, error: null }], rpc);
    await expect(service.confirmar(enrollmentId, confirmation)).rejects.toMatchObject({ statusCode: 409 });
    expect(from).toHaveBeenCalledTimes(4);
  });

  it('traduce una exclusión perdida en la carrera del INSERT masivo a 409', async () => {
    const insert = createChain({ data: null, error: { code: '23P01', message: 'constraint conflict', details: 'private' } });
    const { service, from } = harness([...context, { data: { id: 'ins-1', rol: 'instructor', activo: true }, error: null }]);
    from.mockReturnValueOnce(insert);
    await expect(service.confirmar(enrollmentId, confirmation)).rejects.toMatchObject({
      statusCode: 409, message: 'El instructor ya tiene una práctica que se solapa con este intervalo',
    });
    expect(insert.insert).toHaveBeenCalledTimes(1);
  });

  it('propaga errores de disponibilidad sin crear prácticas', async () => {
    const error = { code: 'XX000', message: 'error de prueba' };
    await expect(harness(context, jest.fn().mockResolvedValue({ data: null, error }))
      .service.sugerir(enrollmentId, input)).rejects.toEqual(error);
  });
});
