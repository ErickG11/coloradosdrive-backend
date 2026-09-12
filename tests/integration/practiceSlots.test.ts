import request from 'supertest';

jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: { from: jest.fn() },
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
const mockedVerifySupabaseJwt = verifySupabaseJwt as unknown as jest.Mock;

const cohortId = '11111111-1111-4111-8111-111111111111';
const instructorId = '22222222-2222-4222-8222-222222222222';
const slotId = '33333333-3333-4333-8333-333333333333';
const studentId = 'test-user-id'; // mockAuthToken siempre resuelve este sub.

const validCreateBody = {
  cohortId,
  instructorId,
  scheduledAt: '2026-03-01T10:00:00Z',
  durationMinutes: 45,
};

function buildSlotRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: slotId,
    cohort_id: cohortId,
    instructor_id: instructorId,
    student_id: null,
    scheduled_at: validCreateBody.scheduledAt,
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

describe('practice-slots endpoints', () => {
  const app = createApp();

  beforeEach(() => {
    mockedFrom.mockReset();
    mockedVerifySupabaseJwt.mockReset();
  });

  describe('protección por autenticación y rol', () => {
    it('sin token responde 401', async () => {
      const res = await request(app).get('/practice-slots');
      expect(res.status).toBe(401);
    });

    it('POST con rol estudiante responde 403', async () => {
      const res = await request(app)
        .post('/practice-slots')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`)
        .send(validCreateBody);
      expect(res.status).toBe(403);
      expect(mockedFrom).not.toHaveBeenCalled();
    });

    it('PATCH con rol instructor responde 403', async () => {
      const res = await request(app)
        .patch(`/practice-slots/${slotId}`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'instructor')}`)
        .send({ durationMinutes: 60 });
      expect(res.status).toBe(403);
    });

    it('DELETE con rol estudiante responde 403', async () => {
      const res = await request(app)
        .delete(`/practice-slots/${slotId}`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);
      expect(res.status).toBe(403);
    });
  });

  describe('POST /practice-slots (admin)', () => {
    it('responde 404 si la cohorte no existe', async () => {
      mockedFrom.mockReturnValueOnce(createChain({ data: null, error: null }));

      const res = await request(app)
        .post('/practice-slots')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
        .send(validCreateBody);

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('La cohorte indicada no existe');
    });

    it('responde 404 si el instructor no existe', async () => {
      mockedFrom
        .mockReturnValueOnce(createChain({ data: { id: cohortId }, error: null }))
        .mockReturnValueOnce(createChain({ data: null, error: null }));

      const res = await request(app)
        .post('/practice-slots')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
        .send(validCreateBody);

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('El instructor indicado no existe');
    });

    it('responde 400 si el usuario indicado no tiene rol instructor', async () => {
      mockedFrom
        .mockReturnValueOnce(createChain({ data: { id: cohortId }, error: null }))
        .mockReturnValueOnce(
          createChain({ data: { id: instructorId, rol: 'estudiante' }, error: null }),
        );

      const res = await request(app)
        .post('/practice-slots')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
        .send(validCreateBody);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('El usuario indicado no tiene rol instructor');
    });

    it('crea la franja con status disponible y responde 201', async () => {
      mockedFrom
        .mockReturnValueOnce(createChain({ data: { id: cohortId }, error: null }))
        .mockReturnValueOnce(
          createChain({ data: { id: instructorId, rol: 'instructor' }, error: null }),
        )
        .mockReturnValueOnce(createChain({ data: buildSlotRow(), error: null }));

      const res = await request(app)
        .post('/practice-slots')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
        .send(validCreateBody);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: slotId,
        cohortId,
        instructorId,
        studentId: null,
        status: 'disponible',
      });
    });
  });

  describe('GET /practice-slots', () => {
    it('admin: lista todas las franjas', async () => {
      mockedFrom.mockReturnValueOnce(createChain({ data: [buildSlotRow()], error: null }));

      const res = await request(app)
        .get('/practice-slots')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(mockedFrom).toHaveBeenCalledTimes(1);
    });

    it('estudiante sin inscripción activa: responde una lista vacía', async () => {
      mockedFrom.mockReturnValueOnce(createChain({ data: null, error: null }));

      const res = await request(app)
        .get('/practice-slots')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('estudiante con inscripción activa: ve disponibles de su cohorte + las propias', async () => {
      const chain = createChain({
        data: [
          buildSlotRow(),
          buildSlotRow({ id: 'slot-2', student_id: studentId, status: 'asignado' }),
        ],
        error: null,
      });
      mockedFrom
        .mockReturnValueOnce(createChain({ data: { cohort_id: cohortId }, error: null }))
        .mockReturnValueOnce(chain);

      const res = await request(app)
        .get('/practice-slots')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(chain.or).toHaveBeenCalledWith(
        `status.eq.disponible,status.eq.liberado,student_id.eq.${studentId}`,
      );
    });

    it('estudiante B ve la franja que el estudiante A acaba de liberar (cancelar)', async () => {
      // El estudiante A cancela: la franja queda en 'liberado' con
      // student_id ya en NULL (ver PracticeSlotActionService.cancelSlot).
      // Sin 'status.eq.liberado' en el filtro, esta fila no matchearía
      // ninguna condición del .or() para el estudiante B y se volvería
      // invisible para reclamarla de nuevo.
      const releasedByStudentA = buildSlotRow({
        id: 'slot-released',
        status: 'liberado',
        student_id: null,
      });
      const chain = createChain({ data: [releasedByStudentA], error: null });
      mockedFrom
        .mockReturnValueOnce(createChain({ data: { cohort_id: cohortId }, error: null }))
        .mockReturnValueOnce(chain);

      const res = await request(app)
        .get('/practice-slots')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([expect.objectContaining({ id: 'slot-released', status: 'liberado' })]);
    });

    it('instructor: ve todas sus franjas, en cualquier estado', async () => {
      const chain = createChain({
        data: [buildSlotRow({ status: 'completado', student_id: studentId })],
        error: null,
      });
      mockedFrom.mockReturnValueOnce(chain);

      const res = await request(app)
        .get('/practice-slots')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'instructor')}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      // mockAuthToken siempre resuelve sub: 'test-user-id' - la query se
      // filtra por el id del propio token, no por un instructorId ajeno.
      expect(chain.eq).toHaveBeenCalledWith('instructor_id', studentId);
    });
  });

  describe('PATCH /practice-slots/:id (admin)', () => {
    it('responde 409 si la franja ya no está disponible', async () => {
      mockedFrom
        .mockReturnValueOnce(createChain({ data: null, error: null })) // update no matchea (ya reclamada)
        .mockReturnValueOnce(
          createChain({ data: buildSlotRow({ status: 'asignado' }), error: null }),
        ); // getSlotRowOrThrow

      const res = await request(app)
        .patch(`/practice-slots/${slotId}`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
        .send({ durationMinutes: 60 });

      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Solo se puede editar una franja disponible (sin reclamar)');
    });

    it('edita la franja disponible y responde 200', async () => {
      mockedFrom.mockReturnValueOnce(
        createChain({ data: buildSlotRow({ duration_minutes: 60 }), error: null }),
      );

      const res = await request(app)
        .patch(`/practice-slots/${slotId}`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
        .send({ durationMinutes: 60 });

      expect(res.status).toBe(200);
      expect(res.body.durationMinutes).toBe(60);
    });
  });

  describe('DELETE /practice-slots/:id (admin)', () => {
    it('responde 409 si la franja ya no está disponible', async () => {
      mockedFrom
        .mockReturnValueOnce(createChain({ data: null, error: null, count: 0 }))
        .mockReturnValueOnce(
          createChain({ data: buildSlotRow({ status: 'confirmado' }), error: null }),
        );

      const res = await request(app)
        .delete(`/practice-slots/${slotId}`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`);

      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Solo se puede eliminar una franja disponible (sin reclamar)');
    });

    it('elimina la franja disponible y responde 204', async () => {
      mockedFrom.mockReturnValueOnce(createChain({ data: null, error: null, count: 1 }));

      const res = await request(app)
        .delete(`/practice-slots/${slotId}`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`);

      expect(res.status).toBe(204);
    });
  });
});
