import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, ManualOperation } from '../../src/config/database.types';
import type { ManualEnrollmentInput } from '../../src/models/manualEnrollment.model';
import { ManualEnrollmentService } from '../../src/services/manualEnrollment.service';
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
    const db = { rpc } as unknown as SupabaseClient<Database>;
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
    const db = { rpc, auth: { admin: { createUser } } } as unknown as SupabaseClient<Database>;
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
      from = jest.fn().mockReturnValue(chain);
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
      db = { rpc, auth: { admin: { deleteUser } } } as unknown as SupabaseClient<Database>;
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
      db = { rpc, auth: { admin: { deleteUser } } } as unknown as SupabaseClient<Database>;
    await expect(
      new ManualEnrollmentService(db, {} as EmailService).confirm('admin', 'op', {
        ...input,
        practice: { ...input.practice, horasPorDia: 0 },
      }),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
