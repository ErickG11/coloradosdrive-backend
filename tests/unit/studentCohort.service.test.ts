import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import { StudentCohortService, studentCohortError } from '../../src/services/studentCohort.service';
import type { CohortAssignmentService } from '../../src/services/cohortAssignment.service';
import { createChain } from '../helpers/supabaseMock';

const student = '22222222-2222-4222-8222-222222222222';
const actor = '11111111-1111-4111-8111-111111111111';
const enrollment = '33333333-3333-4333-8333-333333333333';
const cohort = '44444444-4444-4444-8444-444444444444';
const version = '2026-01-14T18:00:00.123456+00:00';
function setup(overrides: Record<string, unknown> = {}) {
  const row = {
    id: enrollment,
    course_id: 'course',
    student_id: student,
    status: 'pendiente_cohorte',
    cohort_id: null,
    monto_abonado: '25',
    ...overrides,
  };
  const tables: Record<string, { data: unknown; error: unknown }> = {
    users: { data: { id: student, activo: true }, error: null },
    enrollments: { data: row, error: null },
    student_deletion_operations: { data: null, error: null },
    cohorts: { data: null, error: null },
  };
  const from = jest.fn((name: string) => createChain(tables[name]));
  const rpc = jest.fn().mockResolvedValue({
    data: {
      ...row,
      status: 'activo',
      cohort_id: cohort,
      monto_total: '100',
      descuento: '0',
      updated_at: version,
    },
    error: null,
  });
  const candidate = {
    id: cohort,
    courseId: 'course',
    updatedAt: version,
    nombre: 'Fixture',
    precio: 100,
    cupoMaximo: 2,
    cupoOcupado: 1,
    createdAt: new Date('2025-01-01Z'),
    fechaInicioMatricula: new Date('2026-01-01T05:00:00Z'),
    fechaFinMatricula: new Date('2026-01-15T05:00:00Z'),
    fechaInicioCurso: new Date('2026-02-01T05:00:00Z'),
  };
  const candidatesForCourse = jest.fn().mockResolvedValue([candidate]);
  const db = { from, rpc } as unknown as SupabaseClient<Database>;
  const service = new StudentCohortService(db, {
    candidatesForCourse,
  } as unknown as CohortAssignmentService);
  return { service, from, rpc, row, candidate, candidatesForCourse, tables };
}
describe('C: asignación tardía', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-16T04:59:59Z'));
    jest.spyOn(console, 'error').mockImplementation();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  it('reutiliza opciones/sugerencia del curso exacto y no expone la versión interna', async () => {
    const s = setup();
    const result = await s.service.options(student, enrollment);
    expect(s.candidatesForCourse).toHaveBeenCalledWith('course');
    expect(result).toMatchObject({
      enrollmentId: enrollment,
      suggestion: { cohortId: cohort },
      items: [{ id: cohort, cuposDisponibles: 1, fechaFinMatricula: '2026-01-15' }],
    });
    expect(JSON.stringify(result)).not.toContain(version);
    s.candidate.cupoOcupado = 2;
    expect((await s.service.options(student, enrollment)).items).toEqual([]);
    s.candidate.cupoOcupado = 0;
    jest.setSystemTime(new Date('2026-01-16T05:00:00Z'));
    expect((await s.service.options(student, enrollment)).suggestion.cohortId).toBeNull();
  });
  it('pasa los seis decimales exactos sin Date y día civil inclusivo al único guardado', async () => {
    const s = setup();
    expect(await s.service.assign(actor, student, enrollment, cohort)).toMatchObject({
      enrollmentId: enrollment,
      montoTotal: 100,
      montoAbonado: 25,
      saldo: 75,
    });
    expect(s.rpc).toHaveBeenCalledTimes(1);
    expect(s.rpc).toHaveBeenCalledWith('assign_pending_enrollment_cohort', {
      p_actor: actor,
      p_student: student,
      p_enrollment: enrollment,
      p_cohort: cohort,
      p_cohort_version: version,
      p_validated_day: '2026-01-15',
    });
    expect(s.rpc.mock.calls[0][1].p_cohort_version).not.toBe(new Date(version).toISOString());
    expect(
      s.from.mock.calls.every(
        ([table]) => !['practice_slots', 'enrollment_documents'].includes(table),
      ),
    ).toBe(true);
  });
  it('distingue ventana cerrada de COHORT_CHANGED y no guarda si ya cerró', async () => {
    const s = setup();
    jest.setSystemTime(new Date('2026-01-16T05:00:00Z'));
    await expect(s.service.assign(actor, student, enrollment, cohort)).rejects.toMatchObject({
      statusCode: 409,
      code: 'COHORT_WINDOW_CLOSED',
    });
    expect(s.rpc).not.toHaveBeenCalled();
  });
  it('presenta saldo con centavos sin residuos de coma flotante', async () => {
    const s = setup();
    s.rpc.mockResolvedValue({
      data: {
        ...s.row,
        status: 'activo',
        cohort_id: cohort,
        monto_total: '0.30',
        monto_abonado: '0.20',
        descuento: '0',
        updated_at: version,
      },
      error: null,
    });
    expect((await s.service.assign(actor, student, enrollment, cohort)).saldo).toBe(0.1);
  });
  it('permite repetir la misma asignación ya activa aunque haya cerrado la ventana', async () => {
    const s = setup({ status: 'activo', cohort_id: cohort });
    jest.setSystemTime(new Date('2027-01-01T05:00:00Z'));
    await s.service.assign(actor, student, enrollment, cohort);
    expect(s.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(['retirado', 'finalizado', 'activo'])(
    'rechaza matrícula %s sin reasignar',
    async (status) => {
      const s = setup({ status });
      await expect(s.service.assign(actor, student, enrollment, cohort)).rejects.toMatchObject({
        code: 'ENROLLMENT_NOT_PENDING',
      });
      expect(s.rpc).not.toHaveBeenCalled();
    },
  );
  it('prioriza eliminación pendiente, incluso si está inactivo', async () => {
    const s = setup();
    s.tables.student_deletion_operations.data = { status: 'fallido' };
    s.tables.users.data = { activo: false };
    await expect(s.service.assign(actor, student, enrollment, cohort)).rejects.toMatchObject({
      code: 'DELETION_PENDING',
    });
    expect(s.candidatesForCourse).not.toHaveBeenCalled();
  });
  it.each([
    ['users', null, 'STUDENT_NOT_FOUND'],
    ['users', { activo: false }, 'ACCOUNT_INACTIVE'],
    ['enrollments', null, 'ENROLLMENT_NOT_FOUND'],
  ])('rechaza contexto %s inválido', async (table, data, code) => {
    const s = setup();
    s.tables[table].data = data;
    await expect(s.service.assign(actor, student, enrollment, cohort)).rejects.toMatchObject({
      code,
    });
    expect(s.rpc).not.toHaveBeenCalled();
  });
  it.each([false, true])('distingue cohorte inexistente y otro curso (%s)', async (exists) => {
    const s = setup();
    s.candidatesForCourse.mockResolvedValue([]);
    s.tables.cohorts.data = exists ? { id: cohort } : null;
    await expect(s.service.assign(actor, student, enrollment, cohort)).rejects.toMatchObject({
      code: exists ? 'COHORT_COURSE_MISMATCH' : 'COHORT_NOT_FOUND',
    });
  });
  it('una respuesta perdida no dispara reintentos ni compensaciones; log solo identificadores', async () => {
    const s = setup();
    s.rpc.mockRejectedValue(new Error('private fixture value'));
    await expect(s.service.assign(actor, student, enrollment, cohort)).rejects.toMatchObject({
      statusCode: 503,
      code: 'UNCONFIRMED',
    });
    expect(s.rpc).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'student_cohort_unconfirmed',
        student_id: student,
        enrollment_id: enrollment,
        actor_id: actor,
      }),
    );
  });
  it.each([
    ['CD001', 409, 'COHORT_FULL'],
    ['CD030', 409, 'DELETION_PENDING'],
    ['CD403', 403, 'ACCOUNT_INACTIVE'],
    ['CD404', 404, 'STUDENT_NOT_FOUND'],
    ['CD040', 404, 'ENROLLMENT_NOT_FOUND'],
    ['CD041', 409, 'ENROLLMENT_NOT_PENDING'],
    ['CD042', 404, 'COHORT_NOT_FOUND'],
    ['CD043', 400, 'COHORT_COURSE_MISMATCH'],
    ['CD044', 409, 'COHORT_CHANGED'],
    ['CD045', 409, 'ABONO_EXCEEDS_NET'],
    ['22023', 400, 'INVALID_FIELD'],
    ['42501', 403, 'FORBIDDEN'],
    ['55P03', 409, 'LOCK_CONFLICT'],
    ['40P01', 409, 'LOCK_CONFLICT'],
    ['57014', 503, 'UNCONFIRMED'],
    ['unknown', 503, 'UNCONFIRMED'],
  ])('mapea %s según el código SQL, sin mensajes crudos', async (dbCode, statusCode, code) => {
    const s = setup();
    s.rpc.mockResolvedValue({
      data: null,
      error: { code: dbCode, message: 'private fixture value' },
    });
    await expect(s.service.assign(actor, student, enrollment, cohort)).rejects.toMatchObject({
      statusCode,
      code,
    });
    expect(studentCohortError({ code: dbCode }).message).not.toContain('private fixture');
  });
});
