import request from 'supertest';

jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn(),
    rpc: jest.fn(),
    channel: jest.fn(),
    removeChannel: jest.fn(),
  },
  supabaseAnon: {},
}));

jest.mock('../../src/config/jwks', () => ({
  verifySupabaseJwt: jest.fn(),
}));

import { verifySupabaseJwt } from '../../src/config/jwks';

import { createApp } from '../../src/app';
import { supabaseAdmin } from '../../src/config/supabase';
import { createChain } from '../helpers/supabaseMock';
import { mockAuthToken } from '../helpers/tokens';

const mockedRpc = supabaseAdmin.rpc as jest.Mock;
const mockedFrom = supabaseAdmin.from as jest.Mock;
const mockedChannel = supabaseAdmin.channel as jest.Mock;
const mockedRemoveChannel = supabaseAdmin.removeChannel as jest.Mock;
const mockedVerifySupabaseJwt = verifySupabaseJwt as unknown as jest.Mock;

const cohortId = '11111111-1111-4111-8111-111111111111';
const instructorId = '22222222-2222-4222-8222-222222222222';
const slotId = '33333333-3333-4333-8333-333333333333';
// mockAuthToken siempre resuelve sub: 'test-user-id'.
const studentId = 'test-user-id';

function buildSlotRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: slotId,
    cohort_id: cohortId,
    instructor_id: instructorId,
    student_id: null,
    scheduled_at: '2026-03-01T10:00:00.000Z',
    duration_minutes: 60,
    status: 'disponible',
    confirmation_notified_at: null,
    release_notified_at: null,
    confirmed_at: null,
    attended: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function mockHttpSendSuccess() {
  const httpSend = jest.fn().mockResolvedValue({ success: true });
  mockedChannel.mockReturnValue({ httpSend });
  mockedRemoveChannel.mockResolvedValue(undefined);
  return httpSend;
}

describe('practice-slots student actions', () => {
  const app = createApp();
  beforeEach(() => {
    mockedFrom.mockReset();
    mockedRpc.mockReset();
    mockedChannel.mockReset();
    mockedRemoveChannel.mockReset();
    mockedVerifySupabaseJwt.mockReset();
  });

  function authenticateStudent() {
    mockedFrom.mockReturnValue(createChain({ data: { debe_cambiar_password: false }, error: null }));
    return `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`;
  }

  it.each([
    ['claim', 'admin'], ['confirm', 'instructor'], ['cancel', 'admin'],
  ] as const)('rechaza %s con rol %s antes de la RPC', async (action, role) => {
    const res = await request(app).post(`/practice-slots/${slotId}/${action}`)
      .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, role)}`);
    expect(res.status).toBe(403);
    expect(mockedRpc).not.toHaveBeenCalled();
  });

  it.each([
    ['claim', 'CD404', 404, 'Franja no encontrada'],
    ['claim', 'CD403', 403, 'No tienes una inscripción activa en la cohorte de esta franja'],
    ['claim', 'CD409', 409, 'Esta franja ya no está disponible'],
    ['claim', 'CD023', 409, 'El instructor indicado está inactivo'],
    ['claim', 'CD409', 409, 'La ventana de reclamación ya cerró'],
    ['confirm', 'CD404', 404, 'Franja no encontrada'],
    ['confirm', 'CD409', 409, 'Este turno no está pendiente de confirmación'],
    ['confirm', 'CD409', 409, 'La ventana de confirmación ya cerró'],
    ['cancel', 'CD404', 404, 'Franja no encontrada'],
    ['cancel', 'CD409', 409, 'Este turno no se puede cancelar'],
  ])('%s traduce %s a HTTP %s', async (action, code, status, message) => {
    mockedRpc.mockReturnValue(createChain({ data: null, error: { code, message } }));
    const res = await request(app).post(`/practice-slots/${slotId}/${action}`)
      .set('Authorization', authenticateStudent());
    expect(res.status).toBe(status);
    expect(res.body.message).toBe(message);
    expect(mockedChannel).not.toHaveBeenCalled();
  });

  it.each(['claim', 'confirm'] as const)('%s usa el actor del JWT y devuelve el DTO vigente', async (action) => {
    mockedRpc.mockReturnValue(createChain({
      data: buildSlotRow({ student_id: studentId, status: action === 'claim' ? 'asignado' : 'confirmado' }),
      error: null,
    }));
    const res = await request(app).post(`/practice-slots/${slotId}/${action}`)
      .set('Authorization', authenticateStudent()).send({ studentId: 'otro-actor', now: 'ayer' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: slotId, studentId, durationMinutes: 60 });
    expect(mockedRpc).toHaveBeenCalledWith('act_on_practice_slot', {
      p_slot_id: slotId, p_student_id: studentId, p_action: action,
    });
  });

  it('simula dos respuestas de reclamación concurrentes: HTTP 200 y 409 (no demuestra locks SQL)', async () => {
    mockedRpc.mockReturnValueOnce(createChain({
      data: buildSlotRow({ student_id: studentId, status: 'asignado' }), error: null,
    })).mockReturnValueOnce(createChain({
      data: null, error: { code: 'CD409', message: 'Esta franja ya no está disponible' },
    }));
    const auth = authenticateStudent();
    mockAuthToken(mockedVerifySupabaseJwt, 'estudiante');
    const responses = await Promise.all([1, 2].map(() =>
      request(app).post(`/practice-slots/${slotId}/claim`).set('Authorization', auth)));
    expect(responses.map((res) => res.status).sort()).toEqual([200, 409]);
  });

  it('cancelar devuelve la franja liberada y notifica tras confirmar la escritura', async () => {
    mockedRpc.mockReturnValue(createChain({
      data: buildSlotRow({ status: 'liberado', release_notified_at: '2026-03-01T09:00:00Z' }),
      error: null,
    }));
    const httpSend = mockHttpSendSuccess();
    const res = await request(app).post(`/practice-slots/${slotId}/cancel`)
      .set('Authorization', authenticateStudent());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'liberado', studentId: null, confirmedAt: null, confirmationNotifiedAt: null });
    expect(httpSend).toHaveBeenCalledWith('slot-released', { slotId, scheduledAt: '2026-03-01T10:00:00.000Z' });
  });

  it('una franja reclamada de nuevo no hereda el ciclo anterior devuelto por PostgreSQL', async () => {
    mockedRpc.mockReturnValue(createChain({
      data: buildSlotRow({ status: 'asignado', student_id: studentId }), error: null,
    }));
    const res = await request(app).post(`/practice-slots/${slotId}/claim`)
      .set('Authorization', authenticateStudent());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ confirmedAt: null, confirmationNotifiedAt: null, releaseNotifiedAt: null });
  });

  it('si Realtime falla, la cancelación confirmada sigue respondiendo 200', async () => {
    mockedRpc.mockReturnValue(createChain({ data: buildSlotRow({ status: 'liberado' }), error: null }));
    mockedChannel.mockReturnValue({ httpSend: jest.fn().mockRejectedValue(new Error('fallo simulado')) });
    const logger = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const res = await request(app).post(`/practice-slots/${slotId}/cancel`)
        .set('Authorization', authenticateStudent());
      expect(res.status).toBe(200);
    } finally { logger.mockRestore(); }
  });

  describe('PATCH /practice-slots/:id/attendance (instructor)', () => {
    it('con rol estudiante responde 403', async () => {
      mockedFrom.mockReturnValueOnce(
        createChain({ data: { debe_cambiar_password: false }, error: null }),
      );
      const res = await request(app)
        .patch(`/practice-slots/${slotId}/attendance`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`)
        .send({ attended: true });
      expect(res.status).toBe(403);
      expect(mockedFrom).toHaveBeenCalledTimes(1);
    });

    it('responde 404 si la franja no es del instructor autenticado', async () => {
      // mockAuthToken resuelve sub: 'test-user-id'; la franja pertenece a
      // otro instructor (instructorId).
      mockedFrom.mockReturnValueOnce(createChain({ data: { rol: 'instructor', activo: true, debe_cambiar_password: false }, error: null }));
      mockedFrom.mockReturnValueOnce(
        createChain({
          data: buildSlotRow({ instructor_id: instructorId, status: 'completado' }),
          error: null,
        }),
      );

      const res = await request(app)
        .patch(`/practice-slots/${slotId}/attendance`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'instructor')}`)
        .send({ attended: true });

      expect(res.status).toBe(404);
    });

    it('responde 409 si la franja todavía no está completado', async () => {
      mockedFrom.mockReturnValueOnce(createChain({ data: { rol: 'instructor', activo: true, debe_cambiar_password: false }, error: null }));
      mockedFrom.mockReturnValueOnce(
        createChain({
          data: buildSlotRow({ instructor_id: studentId, status: 'confirmado' }),
          error: null,
        }),
      );

      const res = await request(app)
        .patch(`/practice-slots/${slotId}/attendance`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'instructor')}`)
        .send({ attended: true });

      expect(res.status).toBe(409);
    });

    it('marca asistencia sobre una franja completada propia y responde 200', async () => {
      mockedFrom
        .mockReturnValueOnce(createChain({ data: { rol: 'instructor', activo: true, debe_cambiar_password: false }, error: null }))
        .mockReturnValueOnce(
          createChain({
            data: buildSlotRow({ instructor_id: studentId, status: 'completado' }),
            error: null,
          }),
        )
        .mockReturnValueOnce(
          createChain({
            data: buildSlotRow({ instructor_id: studentId, status: 'completado', attended: true }),
            error: null,
          }),
        );

      const res = await request(app)
        .patch(`/practice-slots/${slotId}/attendance`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'instructor')}`)
        .send({ attended: true });

      expect(res.status).toBe(200);
      expect(res.body.attended).toBe(true);
    });

    it('dos instructores distintos: cada uno solo puede marcar asistencia en sus propias franjas, nunca en las del otro', async () => {
      // mockAuthToken siempre resuelve el mismo sub fijo; para probar dos
      // identidades autenticadas reales (no solo un instructor_id ajeno
      // en la fila) se mockea el JWT verificado directamente, mismo
      // patrón que tests/integration/examAttempts.test.ts.
      const instructorA = 'instructor-a';
      const instructorB = 'instructor-b';
      const slotOfA = '55555555-5555-4555-8555-555555555555';
      const slotOfB = '66666666-6666-4666-8666-666666666666';

      // Instructor A marca asistencia en SU propia franja: funciona.
      mockedFrom
        .mockReturnValueOnce(createChain({ data: { rol: 'instructor', activo: true, debe_cambiar_password: false }, error: null }))
        .mockReturnValueOnce(
          createChain({
            data: buildSlotRow({ id: slotOfA, instructor_id: instructorA, status: 'completado' }),
            error: null,
          }),
        )
        .mockReturnValueOnce(
          createChain({
            data: buildSlotRow({
              id: slotOfA,
              instructor_id: instructorA,
              status: 'completado',
              attended: true,
            }),
            error: null,
          }),
        );
      mockedVerifySupabaseJwt.mockResolvedValueOnce({
        sub: instructorA,
        email: 'a@example.com',
        app_metadata: { role: 'instructor' },
      });

      const resOwn = await request(app)
        .patch(`/practice-slots/${slotOfA}/attendance`)
        .set('Authorization', 'Bearer token-a')
        .send({ attended: true });

      expect(resOwn.status).toBe(200);

      // El mismo instructor A intenta marcar asistencia en una franja de
      // B: 404, nunca ve ni toca la franja ajena.
      mockedFrom.mockReturnValueOnce(createChain({ data: { rol: 'instructor', activo: true, debe_cambiar_password: false }, error: null }));
      mockedFrom.mockReturnValueOnce(
        createChain({
          data: buildSlotRow({ id: slotOfB, instructor_id: instructorB, status: 'completado' }),
          error: null,
        }),
      );
      mockedVerifySupabaseJwt.mockResolvedValueOnce({
        sub: instructorA,
        email: 'a@example.com',
        app_metadata: { role: 'instructor' },
      });

      const resOther = await request(app)
        .patch(`/practice-slots/${slotOfB}/attendance`)
        .set('Authorization', 'Bearer token-a')
        .send({ attended: true });

      expect(resOther.status).toBe(404);
    });
  });
});
