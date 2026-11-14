import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { Database, ManualOperation } from '../../src/config/database.types';
import type { ManualEnrollmentInput } from '../../src/models/manualEnrollment.model';
import { ManualEnrollmentService, manualEnrollmentError } from '../../src/services/manualEnrollment.service';
import type { EmailService } from '../../src/services/email.service';
import { createChain } from '../helpers/supabaseMock';

const input: ManualEnrollmentInput = {
  student: { mode: 'existing', id: 'student' },
  courseType: 'A',
  cohortId: null,
  automatic: true,
  practice: {
    semanas: 1,
    modalidad: 'entre_semana',
    fechaInicio: '2026-09-30',
    horaDeseada: '08:00',
    horasPorDia: 1,
  },
};
const committed = {
  operationId: 'op',
  studentId: 'student',
  studentCreated: false,
  enrollmentId: 'e',
  courseId: 'a',
  courseType: 'A',
  cohortId: null,
  status: 'pendiente_cohorte',
  slotsCreated: 0,
  plan: {},
};
const op: ManualOperation = {
  id: 'op',
  actor_id: 'admin',
  request_hash: 'hash',
  worker_id: 'worker',
  phase: 'committed',
  student_id: 'student',
  student_created: false,
  response: committed,
  email_status: 'failed',
  created_at: '',
  updated_at: '',
};
describe('Idempotencia y estado recuperable de confirmación', () => {
  it('incluye checklist y abono en el hash canónico de la solicitud', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: { ...op, claimed: false }, error: null });
    const db = { rpc,from:jest.fn(()=>createChain({data:null,error:null})) } as unknown as SupabaseClient<Database>;
    const service = new ManualEnrollmentService(db, {} as EmailService);
    await service.confirm('admin', 'op', input);
    await service.confirm('admin', 'op', { ...input,
      documentos: [{ tipo: 'cedula', estado: 'entregado' }],
      pago: { modalidad: 'abono', descuento: 0, montoAbonado: 25 },
    });
    expect(rpc.mock.calls[0][1].p_hash).not.toBe(rpc.mock.calls[1][1].p_hash);
  });
  it('envía a la RPC el abono pendiente y la exención de un estudiante existente', async () => {
    const rpc = jest.fn((name: string) => {
      if (name === 'reserve_manual_enrollment')
        return Promise.resolve({ data: { ...op, phase: 'processing', claimed: true }, error: null });
      if (name === 'commit_manual_enrollment')
        return Promise.resolve({ data: committed, error: null });
      return Promise.resolve({ data: false, error: null });
    });
    const from = jest.fn((table: string) => {
      if (table==='student_deletion_operations') return createChain({data:null,error:null});
      if (table === 'manual_course_catalog')
        return createChain({ data: [{ tipo: 'A', course_id: 'a' }], error: null });
      if (table === 'cohorts') return createChain({ data: [], error: null });
      if (table === 'users') return createChain({ data: {
        id: 'student', rol: 'estudiante', fecha_nacimiento: '1950-01-01',
      }, error: null });
      return createChain({ data: { ...op, email_status: 'sent' }, error: null });
    });
    const db = { rpc, from, auth: { admin: { getUserById: jest.fn().mockResolvedValue({
      data: { user: { app_metadata: { role: 'estudiante' } } }, error: null,
    }) } } } as unknown as SupabaseClient<Database>;
    const service = new ManualEnrollmentService(db, {} as EmailService);
    await service.confirm('admin', 'op', { ...input,
      pago: { modalidad: 'abono', descuento: 0, montoAbonado: 500 },
    });
    expect(rpc).toHaveBeenCalledWith('commit_manual_enrollment', expect.objectContaining({
      p_payment: { modalidad: 'abono', descuento: 0, montoAbonado: 500 },
      p_documents: expect.arrayContaining([
        { tipo: 'papeleta_votacion', estado: 'no_aplica' },
      ]),
    }));
  });
  it('reenvío nuevo pendiente exige regeneración explícita antes de reclamar correo', async () => {
    const rpc = jest.fn(),
      from = jest
        .fn()
        .mockReturnValueOnce(createChain({ data: { ...op, student_created: true }, error: null }))
        .mockReturnValueOnce(
          createChain({
            data: { nombre_completo: 'Nuevo', debe_cambiar_password: true },
            error: null,
          }),
        );
    const db = { rpc, from } as unknown as SupabaseClient<Database>;
    await expect(
      new ManualEnrollmentService(db, {} as EmailService).resend('admin', 'op', false),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(rpc).not.toHaveBeenCalled();
  });
  it('una respuesta perdida de creación Auth conserva needs_review y no permite otro intento', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: { ...op, phase: 'processing', claimed: true }, error: null })
      .mockResolvedValueOnce({ data: { ...op, phase: 'needs_review' }, error: null });
    const catalog = createChain({ data: [{ tipo: 'A', course_id: 'a' }], error: null }),
      cohorts = createChain({ data: [], error: null }),
      users = createChain({ data: null, error: null });
    const from = jest.fn((table: string) =>
      table === 'manual_course_catalog' ? catalog : table === 'cohorts' ? cohorts : users,
    );
    const createUser = jest.fn().mockRejectedValue(new Error('Local induced lost Auth response')),
      deleteUser = jest.fn();
    const db = {
      rpc,
      from,
      auth: { admin: { createUser, deleteUser } },
    } as unknown as SupabaseClient<Database>;
    const request = {
      ...input,
      student: {
        mode: 'new' as const,
        cedula: '9905070099',
        nombreCompleto: 'Sintético',
        correo: 'lost-response@example.test',
      },
    };
    await expect(
      new ManualEnrollmentService(db, {} as EmailService).confirm('admin', 'op', request),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(createUser).toHaveBeenCalledTimes(1);
    expect(deleteUser).not.toHaveBeenCalled();
    expect(users.update).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenLastCalledWith('abort_manual_enrollment', expect.any(Object));
  });
  it('replay devuelve matrícula confirmada incluso si el correo falló, sin crear ni enviar de nuevo', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: { ...op, claimed: false }, error: null }),
      createUser = jest.fn(),
      sendManualEnrollmentEmail = jest.fn();
    const db = { rpc, from:jest.fn(()=>createChain({data:null,error:null})), auth: { admin: { createUser } } } as unknown as SupabaseClient<Database>;
    const service = new ManualEnrollmentService(db, {
      sendManualEnrollmentEmail,
    } as unknown as EmailService);
    expect(await service.confirm('admin', 'op', input)).toMatchObject({
      enrollmentId: 'e',
      emailStatus: 'failed',
    });
    expect(createUser).not.toHaveBeenCalled();
    expect(sendManualEnrollmentEmail).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it.each(['processing', 'needs_review'] as const)(
    'una operación %s no se roba por timeout',
    async (phase) => {
      const createUser = jest.fn(),
        db = {
          from:jest.fn(()=>createChain({data:null,error:null})),
          rpc: jest.fn().mockResolvedValue({ data: { ...op, phase, claimed: false }, error: null }),
          auth: { admin: { createUser } },
        } as unknown as SupabaseClient<Database>;
      await expect(
        new ManualEnrollmentService(db, {} as EmailService).confirm('admin', 'op', input),
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(createUser).not.toHaveBeenCalled();
    },
  );
  it('clave con otro payload no ejecuta Auth', async () => {
    const createUser = jest.fn(),
      db = {
        from:jest.fn(()=>createChain({data:null,error:null})),
        rpc: jest.fn().mockResolvedValue({
          data: null,
          error: { code: 'CD021', message: 'Clave utilizada con otra operación' },
        }),
        auth: { admin: { createUser } },
      } as unknown as SupabaseClient<Database>;
    await expect(
      new ManualEnrollmentService(db, {} as EmailService).confirm('admin', 'op', input),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(createUser).not.toHaveBeenCalled();
  });
  it('un plan inválido aborta mediante la cerca SQL y queda reintentable sin tocar cuentas', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: { ...op, phase: 'processing', claimed: true }, error: null })
      .mockResolvedValueOnce({ data: { ...op, phase: 'needs_review' }, error: null });
    const chain = createChain({ data: { id: 'op' }, error: null });
    const deleteUser = jest.fn(),
      from = jest.fn((table:string)=>table==='student_deletion_operations'?createChain({data:null,error:null}):chain);
    const db = {
      rpc,
      from,
      auth: { admin: { deleteUser } },
    } as unknown as SupabaseClient<Database>;
    await expect(
      new ManualEnrollmentService(db, {} as EmailService).confirm('admin', 'op', {
        ...input,
        practice: { ...input.practice, fechaFin: '2026-09-01' },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(rpc.mock.calls[1][0]).toBe('abort_manual_enrollment');
    expect(deleteUser).not.toHaveBeenCalled();
    expect(chain.update).toHaveBeenCalledWith({
      phase: 'failed',
      student_id: null,
      student_created: false,
    });
  });
  it('una respuesta incierta que ya hizo commit se devuelve y no compensa Auth', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: { ...op, phase: 'processing', claimed: true }, error: null })
      .mockResolvedValueOnce({ data: op, error: null });
    const deleteUser = jest.fn(),
      db = { rpc, from:jest.fn(()=>createChain({data:null,error:null})), auth: { admin: { deleteUser } } } as unknown as SupabaseClient<Database>;
    expect(
      await new ManualEnrollmentService(db, {} as EmailService).confirm('admin', 'op', {
        ...input,
        practice: { ...input.practice, horasPorDia: 0 },
      }),
    ).toMatchObject({ enrollmentId: 'e' });
    expect(deleteUser).not.toHaveBeenCalled();
  });
  it('si no se puede cercar el resultado, conserva la cuenta y exige consultar', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: { ...op, phase: 'processing', claimed: true }, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: 'connection_lost' } });
    const deleteUser = jest.fn(),
      db = { rpc, from:jest.fn(()=>createChain({data:null,error:null})), auth: { admin: { deleteUser } } } as unknown as SupabaseClient<Database>;
    await expect(
      new ManualEnrollmentService(db, {} as EmailService).confirm('admin', 'op', {
        ...input,
        practice: { ...input.practice, horasPorDia: 0 },
      }),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(deleteUser).not.toHaveBeenCalled();
  });
});

describe('Errores de confirmación con field y code (paso 5 vuelve al paso afectado)', () => {
  const request = {
    ...input,
    student: {
      mode: 'new' as const,
      cedula: '1710034065',
      nombreCompleto: 'Sintético',
      correo: 'sintetico@example.test',
    },
  };
  function build(profile: unknown, createUser: jest.Mock) {
    const rpc = jest.fn((name: string) =>
      Promise.resolve(
        name === 'reserve_manual_enrollment'
          ? { data: { ...op, phase: 'processing', claimed: true }, error: null }
          : { data: { ...op, phase: 'failed' }, error: null },
      ),
    );
    const from = jest.fn((table: string) =>
      table === 'manual_course_catalog'
        ? createChain({ data: [{ tipo: 'A', course_id: 'a' }], error: null })
        : table === 'cohorts'
          ? createChain({ data: [], error: null })
          : createChain({ data: profile, error: null }),
    );
    const deleteUser = jest.fn();
    const db = { rpc, from, auth: { admin: { createUser, deleteUser } } } as unknown as
      SupabaseClient<Database>;
    return { service: new ManualEnrollmentService(db, {} as EmailService), createUser, deleteUser };
  }

  it('cédula ya registrada: 409 DUPLICATE_CEDULA en student.cedula y no crea la cuenta', async () => {
    const { service, createUser } = build({ id: 'otro' }, jest.fn());
    await expect(service.confirm('admin', 'op', request)).rejects.toMatchObject({
      statusCode: 409,
      code: 'DUPLICATE_CEDULA',
      field: 'student.cedula',
      message: 'La cédula ya existe. Busca y selecciona el estudiante existente.',
    });
    expect(createUser).not.toHaveBeenCalled();
  });

  it('correo ya registrado en Auth: 409 DUPLICATE_EMAIL en student.correo', async () => {
    const createUser = jest.fn().mockResolvedValue({
      data: null,
      error: { status: 422, code: 'email_exists', message: 'exists' },
    });
    const { service, deleteUser } = build(null, createUser);
    await expect(service.confirm('admin', 'op', request)).rejects.toMatchObject({
      statusCode: 409,
      code: 'DUPLICATE_EMAIL',
      field: 'student.correo',
      message: 'El correo ya existe. Busca y selecciona el estudiante existente.',
    });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('carrera de dos administradores (23505): cédula única -> DUPLICATE_CEDULA; otra restricción -> 409 general', () => {
    expect(manualEnrollmentError({ code: '23505',
      message: 'duplicate key value violates unique constraint "users_cedula_unique"' } as PostgrestError))
      .toMatchObject({ statusCode: 409, code: 'DUPLICATE_CEDULA', field: 'student.cedula' });
    const general = manualEnrollmentError({ code: '23505', message: 'otra restricción' } as PostgrestError);
    expect(general).toMatchObject({ statusCode: 409 });
    expect(general).not.toHaveProperty('code', 'DUPLICATE_CEDULA');
  });

  it('cupo agotado detectado por la base (CD001): 409 COHORT_FULL en cohortId', () => {
    expect(
      manualEnrollmentError({ code: 'CD001', message: 'x' } as PostgrestError),
    ).toMatchObject({
      statusCode: 409,
      code: 'COHORT_FULL',
      field: 'cohortId',
      message: 'La cohorte ya no tiene cupo disponible.',
    });
  });

  it('cohorte inexistente, de otro curso y con matrícula cerrada indican cohortId', async () => {
    const today = '2026-10-21';
    const cohort = (over: object) => ({
      id: 'c', course_id: 'course', precio: '100',
      fecha_inicio_matricula: today, fecha_fin_matricula: today, ...over,
    });
    const run = async (cohortRow: unknown, courseTipo: string) => {
      const from = jest.fn((table: string) =>
        table === 'manual_course_catalog'
          ? createChain({ data: [{ tipo: 'A', course_id: 'a' }], error: null })
          : table === 'cohorts'
            ? createChain({ data: cohortRow, error: null })
            : createChain({ data: { tipo: courseTipo }, error: null }),
      );
      const service = new ManualEnrollmentService({ from } as unknown as SupabaseClient<Database>,
        {} as EmailService);
      return service.practicePreview({ ...input, automatic: false, cohortId: 'c' }, 'admin-1');
    };
    jest.useFakeTimers().setSystemTime(new Date('2026-10-21T15:00:00Z'));
    try {
      await expect(run(null, 'A')).rejects.toMatchObject({
        statusCode: 404, code: 'COHORT_NOT_FOUND', field: 'cohortId' });
      await expect(run(cohort({}), 'B')).rejects.toMatchObject({
        statusCode: 400, code: 'COHORT_COURSE_MISMATCH', field: 'cohortId',
        message: 'La cohorte seleccionada no corresponde al curso elegido.' });
      await expect(run(cohort({ fecha_fin_matricula: '2026-10-20' }), 'A')).rejects.toMatchObject({
        statusCode: 409, code: 'COHORT_ENROLLMENT_CLOSED', field: 'cohortId',
        message: 'La matrícula de la cohorte no está abierta.' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('sin instructor y con cohorte, indica practice.instructorId', () => {
    const { service } = build(null, jest.fn());
    // El plan con cohorte exige instructor antes de crear nada.
    expect(() => (service as unknown as {
      requireInstructor: (p: object) => string }).requireInstructor(input.practice)).toThrow(
      expect.objectContaining({ field: 'practice.instructorId',
        message: 'Selecciona un instructor antes de confirmar.' }),
    );
  });
});
