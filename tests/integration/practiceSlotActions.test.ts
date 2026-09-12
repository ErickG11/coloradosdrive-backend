import request from 'supertest';

jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn(),
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
    duration_minutes: 45,
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
    mockedChannel.mockReset();
    mockedRemoveChannel.mockReset();
    mockedVerifySupabaseJwt.mockReset();
  });

  describe('protección por rol', () => {
    it('POST .../claim con rol admin responde 403', async () => {
      const res = await request(app)
        .post(`/practice-slots/${slotId}/claim`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`);
      expect(res.status).toBe(403);
      expect(mockedFrom).not.toHaveBeenCalled();
    });

    it('POST .../confirm con rol instructor responde 403', async () => {
      const res = await request(app)
        .post(`/practice-slots/${slotId}/confirm`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'instructor')}`);
      expect(res.status).toBe(403);
    });

    it('POST .../cancel con rol admin responde 403', async () => {
      const res = await request(app)
        .post(`/practice-slots/${slotId}/cancel`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`);
      expect(res.status).toBe(403);
    });
  });

  describe('POST /practice-slots/:id/claim (estudiante)', () => {
    it('responde 404 si la franja no existe', async () => {
      mockedFrom.mockReturnValueOnce(createChain({ data: null, error: null }));

      const res = await request(app)
        .post(`/practice-slots/${slotId}/claim`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);

      expect(res.status).toBe(404);
    });

    it('responde 403 si el estudiante no está en la cohorte de la franja', async () => {
      mockedFrom
        .mockReturnValueOnce(createChain({ data: buildSlotRow(), error: null }))
        .mockReturnValueOnce(createChain({ data: null, error: null }));

      const res = await request(app)
        .post(`/practice-slots/${slotId}/claim`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);

      expect(res.status).toBe(403);
    });

    it('reclama la franja disponible y responde 200', async () => {
      mockedFrom
        .mockReturnValueOnce(createChain({ data: buildSlotRow(), error: null }))
        .mockReturnValueOnce(createChain({ data: { id: 'enrollment-1' }, error: null }))
        .mockReturnValueOnce(
          createChain({
            data: buildSlotRow({ student_id: studentId, status: 'asignado' }),
            error: null,
          }),
        );

      const res = await request(app)
        .post(`/practice-slots/${slotId}/claim`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ studentId, status: 'asignado' });
    });

    it('condición de carrera: dos solicitudes reclamando la misma franja, solo una gana', async () => {
      // No se simula concurrencia real (el mock es una cola secuencial de
      // respuestas, no una base de datos con locking real) - se prueba
      // directamente el mecanismo que sí previene la carrera en
      // producción: el UPDATE atómico con WHERE status IN (...). La
      // primera solicitud encuentra la fila disponible y la reclama; la
      // segunda, aunque haga exactamente la misma secuencia de consultas,
      // no encuentra ninguna fila que matchee (ya cambió de estado) y
      // recibe 409 - así se comportaría sin importar cuál de las dos
      // peticiones reales llegara primero al servidor.
      mockedFrom
        // Solicitud A: gana.
        .mockReturnValueOnce(createChain({ data: buildSlotRow(), error: null }))
        .mockReturnValueOnce(createChain({ data: { id: 'enrollment-1' }, error: null }))
        .mockReturnValueOnce(
          createChain({
            data: buildSlotRow({ student_id: studentId, status: 'asignado' }),
            error: null,
          }),
        )
        // Solicitud B: pierde (el UPDATE no matchea ninguna fila).
        .mockReturnValueOnce(createChain({ data: buildSlotRow(), error: null }))
        .mockReturnValueOnce(createChain({ data: { id: 'enrollment-1' }, error: null }))
        .mockReturnValueOnce(createChain({ data: null, error: null }));

      const resA = await request(app)
        .post(`/practice-slots/${slotId}/claim`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);
      const resB = await request(app)
        .post(`/practice-slots/${slotId}/claim`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(409);
      expect(resB.body.message).toBe('Esta franja ya no está disponible');
    });
  });

  describe('POST /practice-slots/:id/confirm (estudiante)', () => {
    it('responde 404 si la franja no es del estudiante', async () => {
      mockedFrom.mockReturnValueOnce(
        createChain({ data: buildSlotRow({ student_id: 'otro-estudiante' }), error: null }),
      );

      const res = await request(app)
        .post(`/practice-slots/${slotId}/confirm`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);

      expect(res.status).toBe(404);
    });

    it('responde 409 si la ventana de confirmación ya cerró (menos de 5 min antes)', async () => {
      const soon = new Date(Date.now() + 2 * 60_000).toISOString();
      mockedFrom.mockReturnValueOnce(
        createChain({
          data: buildSlotRow({ student_id: studentId, status: 'asignado', scheduled_at: soon }),
          error: null,
        }),
      );

      const res = await request(app)
        .post(`/practice-slots/${slotId}/confirm`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);

      expect(res.status).toBe(409);
      expect(res.body.message).toBe('La ventana de confirmación ya cerró');
    });

    it('confirma dentro de la ventana y responde 200', async () => {
      const later = new Date(Date.now() + 15 * 60_000).toISOString();
      mockedFrom
        .mockReturnValueOnce(
          createChain({
            data: buildSlotRow({ student_id: studentId, status: 'asignado', scheduled_at: later }),
            error: null,
          }),
        )
        .mockReturnValueOnce(
          createChain({
            data: buildSlotRow({
              student_id: studentId,
              status: 'confirmado',
              scheduled_at: later,
            }),
            error: null,
          }),
        );

      const res = await request(app)
        .post(`/practice-slots/${slotId}/confirm`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('confirmado');
    });
  });

  describe('POST /practice-slots/:id/cancel (estudiante)', () => {
    it('responde 409 si el turno ya está liberado', async () => {
      mockedFrom.mockReturnValueOnce(
        createChain({
          data: buildSlotRow({ student_id: studentId, status: 'liberado' }),
          error: null,
        }),
      );

      const res = await request(app)
        .post(`/practice-slots/${slotId}/cancel`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);

      expect(res.status).toBe(409);
    });

    it('responde 409 si el turno ya está completado (no se puede cancelar una práctica que ya pasó)', async () => {
      mockedFrom.mockReturnValueOnce(
        createChain({
          data: buildSlotRow({ student_id: studentId, status: 'completado' }),
          error: null,
        }),
      );

      const res = await request(app)
        .post(`/practice-slots/${slotId}/cancel`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);

      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Este turno no se puede cancelar');
    });

    it('cancela, libera el cupo, resetea el ciclo de confirmación, y notifica a la cohorte por Realtime', async () => {
      const httpSend = mockHttpSendSuccess();
      const updateChain = createChain({ data: buildSlotRow({ status: 'liberado' }), error: null });
      mockedFrom
        .mockReturnValueOnce(
          createChain({
            data: buildSlotRow({ student_id: studentId, status: 'confirmado' }),
            error: null,
          }),
        )
        .mockReturnValueOnce(updateChain);

      const res = await request(app)
        .post(`/practice-slots/${slotId}/cancel`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('liberado');
      expect(res.body.studentId).toBeNull();
      // No basta con lo que el mock "devuelve" (buildSlotRow ya trae estos
      // campos en null por defecto, eso no prueba nada por sí solo) - se
      // verifica el payload real que el servicio le manda a .update(): sin
      // este reset, un segundo estudiante que reclame esta misma franja
      // después heredaría confirmation_notified_at ya puesto y nunca
      // recibiría su propia notificación de 20 minutos (ver docs/adr/007).
      expect(updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          student_id: null,
          status: 'liberado',
          confirmed_at: null,
          confirmation_notified_at: null,
        }),
      );
      expect(mockedChannel).toHaveBeenCalledWith(`cohort-${cohortId}-practice-slots`);
      expect(httpSend).toHaveBeenCalledWith('slot-released', expect.objectContaining({ slotId }));
    });

    it('un segundo estudiante que reclama la franja liberada no hereda campos del ciclo anterior', async () => {
      // Complementa el test anterior: cancelSlot() ya prueba que RESETEA
      // los campos; este prueba que claimSlot() no los TOCA (no los
      // sobrescribe con algo distinto de null) - juntos confirman que la
      // franja llega "limpia" al segundo estudiante.
      const releasedSlotId = '44444444-4444-4444-8444-444444444444';
      const claimChain = createChain({
        data: buildSlotRow({ id: releasedSlotId, student_id: studentId, status: 'asignado' }),
        error: null,
      });
      mockedFrom
        .mockReturnValueOnce(
          createChain({
            data: buildSlotRow({ id: releasedSlotId, status: 'liberado' }),
            error: null,
          }),
        )
        .mockReturnValueOnce(createChain({ data: { id: 'enrollment-1' }, error: null }))
        .mockReturnValueOnce(claimChain);

      const res = await request(app)
        .post(`/practice-slots/${releasedSlotId}/claim`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);

      expect(res.status).toBe(200);
      expect(claimChain.update).toHaveBeenCalledWith({
        student_id: 'test-user-id',
        status: 'asignado',
      });
    });

    it('si la notificación Realtime falla, la cancelación igual se confirma (best-effort)', async () => {
      const httpSend = jest.fn().mockResolvedValue({ success: false, status: 500, error: 'boom' });
      mockedChannel.mockReturnValue({ httpSend });
      mockedRemoveChannel.mockResolvedValue(undefined);

      mockedFrom
        .mockReturnValueOnce(
          createChain({
            data: buildSlotRow({ student_id: studentId, status: 'asignado' }),
            error: null,
          }),
        )
        .mockReturnValueOnce(
          createChain({ data: buildSlotRow({ status: 'liberado' }), error: null }),
        );

      const res = await request(app)
        .post(`/practice-slots/${slotId}/cancel`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);

      expect(res.status).toBe(200);
    });
  });

  describe('PATCH /practice-slots/:id/attendance (instructor)', () => {
    it('con rol estudiante responde 403', async () => {
      const res = await request(app)
        .patch(`/practice-slots/${slotId}/attendance`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`)
        .send({ attended: true });
      expect(res.status).toBe(403);
      expect(mockedFrom).not.toHaveBeenCalled();
    });

    it('responde 404 si la franja no es del instructor autenticado', async () => {
      // mockAuthToken resuelve sub: 'test-user-id'; la franja pertenece a
      // otro instructor (instructorId).
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
