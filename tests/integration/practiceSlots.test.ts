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
  durationMinutes: 60,
};

function buildSlotRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: slotId,
    cohort_id: cohortId,
    instructor_id: instructorId,
    student_id: null,
    scheduled_at: validCreateBody.scheduledAt,
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

// Los 3 listados (GET /practice-slots) embeben instructor/estudiante vía
// PostgREST (ver docs/adr/008) - a diferencia de buildSlotRow, que refleja
// la fila cruda que usan create/update/delete (sin embed).
function buildSlotRowWithNames(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...buildSlotRow(),
    instructor: { nombre_completo: 'Bruno Salas' },
    student: null,
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
      mockedFrom.mockReturnValueOnce(
        createChain({ data: { debe_cambiar_password: false }, error: null }),
      );
      const res = await request(app)
        .post('/practice-slots')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`)
        .send(validCreateBody);
      expect(res.status).toBe(403);
      expect(mockedFrom).toHaveBeenCalledTimes(1);
    });

    it('PATCH con rol instructor responde 403', async () => {
      const res = await request(app)
        .patch(`/practice-slots/${slotId}`)
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'instructor')}`)
        .send({ durationMinutes: 60 });
      expect(res.status).toBe(403);
    });

    it('DELETE con rol estudiante responde 403', async () => {
      mockedFrom.mockReturnValueOnce(
        createChain({ data: { debe_cambiar_password: false }, error: null }),
      );
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
    it('admin: lista todas las franjas, con instructor/estudiante embebidos', async () => {
      const chain = createChain({
        data: [buildSlotRowWithNames({ student: { nombre_completo: 'Ana Torres' } })],
        error: null,
      });
      mockedFrom.mockReturnValueOnce(chain);

      const res = await request(app)
        .get('/practice-slots')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        expect.objectContaining({ instructorName: 'Bruno Salas', studentName: 'Ana Torres' }),
      ]);
      expect(mockedFrom).toHaveBeenCalledTimes(1);
      // El select pide el embed vía las FK desambiguadas (hay 2 FKs de
      // practice_slots hacia users) - sin esto, instructorName/studentName
      // nunca llegarían resueltos.
      expect(chain.select).toHaveBeenCalledWith(expect.stringContaining('instructor:users!'));
      expect(chain.select).toHaveBeenCalledWith(expect.stringContaining('student:users!'));
    });

    it('admin: una franja sin estudiante asignado trae studentName null', async () => {
      mockedFrom.mockReturnValueOnce(
        createChain({ data: [buildSlotRowWithNames({ student: null })], error: null }),
      );

      const res = await request(app)
        .get('/practice-slots')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([expect.objectContaining({ studentName: null })]);
    });

    it('admin: franjas disponible/liberado siempre traen colorSemana verde, sin consultar nada extra', async () => {
      mockedFrom.mockReturnValueOnce(
        createChain({
          data: [
            buildSlotRowWithNames({
              id: 'a',
              status: 'disponible',
              student: null,
              student_id: null,
            }),
            buildSlotRowWithNames({ id: 'b', status: 'liberado', student: null, student_id: null }),
          ],
          error: null,
        }),
      );

      const res = await request(app)
        .get('/practice-slots')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`);

      expect(res.status).toBe(200);
      expect((res.body as { colorSemana: string }[]).map((s) => s.colorSemana)).toEqual([
        'verde',
        'verde',
      ]);
      // Ningún par (estudiante, cohorte) que resolver -> nunca consulta el rango.
      expect(mockedFrom).toHaveBeenCalledTimes(1);
    });

    it('admin: colorSemana refleja el rango completo de franjas del estudiante en la cohorte, no solo lo que trae este listado filtrado', async () => {
      const anaId = 'ana-1';
      // Este listado (filtrado por instructor, por ejemplo) solo trae DOS
      // franjas de Ana, pero su rango real (siguiente query) abarca desde
      // el día 1 hasta el día 30 - la del medio debe salir 'neutro', no
      // 'amarillo' como saldría si el rango se calculara solo con estas dos.
      const rangoChain = createChain({
        data: [
          { student_id: anaId, cohort_id: cohortId, scheduled_at: '2026-03-01T15:00:00Z' },
          { student_id: anaId, cohort_id: cohortId, scheduled_at: '2026-03-30T15:00:00Z' },
        ],
        error: null,
      });
      mockedFrom
        .mockReturnValueOnce(
          createChain({
            data: [
              buildSlotRowWithNames({
                id: 'mid',
                status: 'confirmado',
                student_id: anaId,
                student: { nombre_completo: 'Ana Torres' },
                scheduled_at: '2026-03-15T15:00:00Z',
              }),
            ],
            error: null,
          }),
        )
        .mockReturnValueOnce(rangoChain);

      const res = await request(app)
        .get('/practice-slots')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([expect.objectContaining({ colorSemana: 'neutro' })]);
      expect(rangoChain.in).toHaveBeenCalledWith('student_id', [anaId]);
      expect(rangoChain.in).toHaveBeenCalledWith('status', ['asignado', 'confirmado']);
    });

    it('admin: rango corto (<= 14 días) siempre da amarillo para asignado/confirmado', async () => {
      const anaId = 'ana-2';
      mockedFrom
        .mockReturnValueOnce(
          createChain({
            data: [
              buildSlotRowWithNames({
                id: 'unica',
                status: 'asignado',
                student_id: anaId,
                student: { nombre_completo: 'Ana Torres' },
                scheduled_at: '2026-03-05T15:00:00Z',
              }),
            ],
            error: null,
          }),
        )
        .mockReturnValueOnce(
          createChain({
            data: [
              { student_id: anaId, cohort_id: cohortId, scheduled_at: '2026-03-05T15:00:00Z' },
            ],
            error: null,
          }),
        );

      const res = await request(app)
        .get('/practice-slots')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([expect.objectContaining({ colorSemana: 'amarillo' })]);
    });

    it('estudiante sin inscripción activa: responde una lista vacía', async () => {
      mockedFrom
        .mockReturnValueOnce(createChain({ data: { debe_cambiar_password: false }, error: null }))
        .mockReturnValueOnce(createChain({ data: null, error: null }));

      const res = await request(app)
        .get('/practice-slots')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('estudiante con inscripción activa: ve disponibles de su cohorte + las propias', async () => {
      const chain = createChain({
        data: [
          buildSlotRowWithNames(),
          buildSlotRowWithNames({
            id: 'slot-2',
            student_id: studentId,
            status: 'asignado',
            student: { nombre_completo: 'Ana Torres' },
          }),
        ],
        error: null,
      });
      mockedFrom
        .mockReturnValueOnce(createChain({ data: { debe_cambiar_password: false }, error: null }))
        .mockReturnValueOnce(createChain({ data: { cohort_id: cohortId }, error: null }))
        .mockReturnValueOnce(chain);

      const res = await request(app)
        .get('/practice-slots')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[1]).toEqual(
        expect.objectContaining({ instructorName: 'Bruno Salas', studentName: 'Ana Torres' }),
      );
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
      const releasedByStudentA = buildSlotRowWithNames({
        id: 'slot-released',
        status: 'liberado',
        student_id: null,
      });
      const chain = createChain({ data: [releasedByStudentA], error: null });
      mockedFrom
        .mockReturnValueOnce(createChain({ data: { debe_cambiar_password: false }, error: null }))
        .mockReturnValueOnce(createChain({ data: { cohort_id: cohortId }, error: null }))
        .mockReturnValueOnce(chain);

      const res = await request(app)
        .get('/practice-slots')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        expect.objectContaining({ id: 'slot-released', status: 'liberado', studentName: null }),
      ]);
    });

    it('instructor: ve todas sus franjas, en cualquier estado, con el nombre del estudiante si tiene', async () => {
      const chain = createChain({
        data: [
          buildSlotRowWithNames({
            status: 'completado',
            student_id: studentId,
            student: { nombre_completo: 'Ana Torres' },
          }),
        ],
        error: null,
      });
      mockedFrom.mockReturnValueOnce(chain);

      const res = await request(app)
        .get('/practice-slots')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'instructor')}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([expect.objectContaining({ studentName: 'Ana Torres' })]);
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

  it.each([45, 90, 0, null, '60'])('POST rechaza duración %s antes de consultar datos', async (duration) => {
    const res = await request(app).post('/practice-slots')
      .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
      .send({ ...validCreateBody, durationMinutes: duration });
    expect(res.status).toBe(400);
    expect(mockedFrom).not.toHaveBeenCalled();
  });

  it('PATCH rechaza una duración distinta de 60', async () => {
    const res = await request(app).patch(`/practice-slots/${slotId}`)
      .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
      .send({ durationMinutes: 45 });
    expect(res.status).toBe(400);
    expect(mockedFrom).not.toHaveBeenCalled();
  });

  it('POST sin duración conserva el contrato y escribe 60 minutos efectivos', async () => {
    const insert = createChain({ data: buildSlotRow(), error: null });
    mockedFrom.mockReturnValueOnce(createChain({ data: { id: cohortId }, error: null }))
      .mockReturnValueOnce(createChain({ data: { id: instructorId, rol: 'instructor' }, error: null }))
      .mockReturnValueOnce(insert);
    const { durationMinutes: _duration, ...withoutDuration } = validCreateBody;
    const res = await request(app).post('/practice-slots')
      .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
      .send(withoutDuration);
    expect(res.status).toBe(201);
    expect(insert.insert).toHaveBeenCalledWith(expect.objectContaining({ duration_minutes: 60 }));
  });

  it.each(['POST', 'PATCH'])('%s traduce solapamientos de PostgreSQL a HTTP 409', async (method) => {
    if (method === 'POST') {
      mockedFrom.mockReturnValueOnce(createChain({ data: { id: cohortId }, error: null }))
        .mockReturnValueOnce(createChain({ data: { id: instructorId, rol: 'instructor' }, error: null }));
    }
    mockedFrom.mockReturnValueOnce(createChain({
      data: null, error: { code: '23P01', message: 'constraint conflict', details: 'identificadores privados' },
    }));
    const route = method === 'POST' ? request(app).post('/practice-slots')
      : request(app).patch(`/practice-slots/${slotId}`);
    const res = await route
      .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
      .send(method === 'POST' ? validCreateBody : { scheduledAt: validCreateBody.scheduledAt });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('El instructor ya tiene una práctica que se solapa con este intervalo');
    expect(JSON.stringify(res.body)).not.toContain('identificadores privados');
  });

});
