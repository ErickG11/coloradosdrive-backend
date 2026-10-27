import request from 'supertest';
jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: { from: jest.fn(), rpc: jest.fn(), channel: jest.fn(), removeChannel: jest.fn() },
  supabaseAnon: {},
}));
jest.mock('../../src/config/jwks', () => ({ verifySupabaseJwt: jest.fn() }));
import { createApp } from '../../src/app';
import { supabaseAdmin } from '../../src/config/supabase';
import { verifySupabaseJwt } from '../../src/config/jwks';
import { createChain } from '../helpers/supabaseMock';
import { mockAuthToken } from '../helpers/tokens';

const rpc = supabaseAdmin.rpc as jest.Mock;
const from = supabaseAdmin.from as jest.Mock;
const verify = verifySupabaseJwt as jest.Mock;
const id = '11111111-1111-4111-8111-111111111111';
const enrollment = '22222222-2222-4222-8222-222222222222';
const app = createApp();
const auth = (role: 'instructor' | 'admin' | 'estudiante' = 'instructor') =>
  `Bearer ${mockAuthToken(verify, role)}`;
const reason = 'Revise la asistencia con el instructor';
const row = {
  id,
  cohort_id: 'cohort',
  instructor_id: 'test-user-id',
  student_id: 'student',
  scheduled_at: '2026-10-25T15:00:00Z',
  duration_minutes: 60,
  status: 'completado',
  attended: false,
  confirmation_notified_at: null,
  release_notified_at: null,
  confirmed_at: null,
  created_at: '',
  updated_at: '',
};

describe('Asistencia E4: contratos y permisos HTTP', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    rpc.mockReset();
    from.mockReset();
    from.mockReturnValue(
      createChain({
        data: { rol: 'instructor', activo: true, debe_cambiar_password: false },
        error: null,
      }),
    );
  });
  it('conserva ruta y respuesta de registro inicial, usando solo el actor autenticado', async () => {
    rpc.mockReturnValue(createChain({ data: row, error: null }));
    const res = await request(app)
      .patch(`/practice-slots/${id}/attendance`)
      .set('Authorization', auth())
      .send({ attended: false, actorId: 'otro', actorRole: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, attended: false, studentId: 'student' });
    expect(rpc).toHaveBeenCalledWith('register_practice_attendance', {
      p_slot: id,
      p_actor: 'test-user-id',
      p_attended: false,
    });
    expect(from).toHaveBeenCalledTimes(1); // Solo autenticacion del instructor, sin UPDATE REST.
  });
  it.each(['instructor', 'admin'] as const)(
    'corrige como %s con motivo recortado',
    async (role) => {
      rpc.mockReturnValue(createChain({ data: row, error: null }));
      const path = `/practice-slots/${id}/attendance${role === 'admin' ? '/correction' : ''}`;
      const res = await request(app)
        .patch(path)
        .set('Authorization', auth(role))
        .send({ attended: false, motivo: `  ${reason}  `, actorId: 'otro' });
      expect(res.status).toBe(200);
      expect(rpc).toHaveBeenCalledWith('correct_practice_attendance', {
        p_slot: id,
        p_actor: 'test-user-id',
        p_attended: false,
        p_motivo: reason,
      });
    },
  );
  it.each([undefined, null, '', ' corto ', 'x'.repeat(501), 42, ['un motivo largo']])(
    'valida motivo del admin %p',
    async (motivo) => {
      const res = await request(app)
        .patch(`/practice-slots/${id}/attendance/correction`)
        .set('Authorization', auth('admin'))
        .send({ attended: true, motivo });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'INVALID_FIELD', field: 'motivo' });
      expect(rpc).not.toHaveBeenCalled();
    },
  );
  it.each([null, '', ' corto ', 'x'.repeat(501)])(
    'no convierte un motivo invalido del instructor en registro %p',
    async (motivo) => {
      const res = await request(app)
        .patch(`/practice-slots/${id}/attendance`)
        .set('Authorization', auth())
        .send({ attended: true, motivo });
      expect(res.status).toBe(400);
      expect(res.body.message).not.toBe('Invalid value');
      expect(rpc).not.toHaveBeenCalled();
    },
  );
  it.each(['false', 0, null, undefined])('exige attended boolean real %p', async (attended) => {
    const res = await request(app)
      .patch(`/practice-slots/${id}/attendance`)
      .set('Authorization', auth())
      .send({ attended });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('attended');
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    ['AT404', 404, 'PRACTICE_NOT_FOUND'],
    ['AT403', 403, 'ATTENDANCE_FORBIDDEN'],
    ['AT410', 409, 'ATTENDANCE_WINDOW_CLOSED'],
    ['AT411', 409, 'ATTENDANCE_SAME_VALUE'],
    ['AT412', 400, 'INVALID_FIELD'],
    ['AT413', 409, 'PRACTICE_NOT_COMPLETED'],
    ['AT414', 409, 'ATTENDANCE_ALREADY_REGISTERED'],
    ['AT415', 409, 'ATTENDANCE_NOT_REGISTERED'],
    ['AT417', 409, 'ATTENDANCE_AUDIT_REQUIRED'],
  ])('traduce %s a %s con codigo estable', async (sqlCode, status, code) => {
    rpc.mockReturnValue(
      createChain({ data: null, error: { code: sqlCode, message: 'Mensaje claro en espanol' } }),
    );
    const res = await request(app)
      .patch(`/practice-slots/${id}/attendance`)
      .set('Authorization', auth())
      .send({ attended: true, motivo: reason });
    expect(res.status).toBe(status);
    expect(res.body.code).toBe(code);
  });
  it('rechaza instructor en correccion y auditoria administrativas', async () => {
    expect(
      (
        await request(app)
          .patch(`/practice-slots/${id}/attendance/correction`)
          .set('Authorization', auth())
          .send({ attended: true, motivo: reason })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get(`/practice-slots/${id}/attendance/events`)
          .set('Authorization', auth())
      ).status,
    ).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('pagina auditoria administrativa y oculta metadatos internos', async () => {
    rpc.mockResolvedValue({
      data: {
        total: 3,
        items: [
          {
            id: 'event',
            slot_id: id,
            actor_id: 'admin',
            actor_role: 'admin',
            created_at: '2026-10-26T12:00:00Z',
            tipo: 'correccion',
            previous_attended: true,
            new_attended: false,
            motivo: reason,
            transaction_id: 123,
          },
        ],
      },
      error: null,
    });
    const res = await request(app)
      .get(`/practice-slots/${id}/attendance/events?page=2&pageSize=1`)
      .set('Authorization', auth('admin'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      page: 2,
      pageSize: 1,
      total: 3,
      items: [
        {
          practiceSlotId: id,
          actorId: 'admin',
          previousAttended: true,
          newAttended: false,
          motivo: reason,
        },
      ],
    });
    expect(res.body.items[0]).not.toHaveProperty('transaction_id');
    expect(rpc).toHaveBeenCalledWith('list_practice_attendance_events', {
      p_actor: 'test-user-id',
      p_slot: id,
      p_page: 2,
      p_page_size: 1,
    });
  });
  it('expone el historial con resumen completo, solo del JWT y matricula solicitada', async () => {
    rpc.mockResolvedValue({
      data: {
        items: [
          {
            id: 'cancellation:c',
            slot_id: id,
            cancellation_id: 'c',
            scheduled_at: '2026-10-25T15:00:00Z',
            duration_minutes: 60,
            slot_status: null,
            attended: null,
            estado: 'falta',
            resultado: 'falta',
            motivo: 'Se agotaron las reprogramaciones',
          },
        ],
        total: 4,
        summary: { horasAsistidas: 2, horasObjetivo: 10, horasPerdidas: 1 },
      },
      error: null,
    });
    const res = await request(app)
      .get(
        `/estudiantes/practice-history?enrollmentId=${enrollment}&page=2&pageSize=1&studentId=otro`,
      )
      .set('Authorization', auth('estudiante'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      enrollmentId: enrollment,
      total: 4,
      items: [{ practiceSlotId: id, estado: 'falta', attended: null }],
      summary: { horasAsistidas: 2, horasObjetivo: 10, horasPerdidas: 1 },
    });
    expect(rpc).toHaveBeenCalledWith('student_practice_history', {
      p_student: 'test-user-id',
      p_enrollment: enrollment,
      p_page: 2,
      p_page_size: 1,
    });
  });
  it.each([
    '',
    'enrollmentId=no-uuid',
    `enrollmentId=${enrollment}&page=0`,
    `enrollmentId=${enrollment}&page=1&page=2`,
    `enrollmentId=${enrollment}&pageSize=101`,
  ])('valida historial %s', async (query) => {
    const res = await request(app)
      .get(`/estudiantes/practice-history?${query}`)
      .set('Authorization', auth('estudiante'));
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('matricula ajena devuelve 404 y exige rol estudiante y sesion', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: 'CD404', message: 'Matricula no encontrada' },
    });
    const path = `/estudiantes/practice-history?enrollmentId=${enrollment}`;
    expect((await request(app).get(path).set('Authorization', auth('estudiante'))).status).toBe(
      404,
    );
    expect((await request(app).get(path).set('Authorization', auth('admin'))).status).toBe(403);
    expect((await request(app).get(path)).status).toBe(401);
  });
  it('lista matriculas historicas con consulta filtrada al propietario', async () => {
    const chain = createChain({
      data: [
        {
          id: enrollment,
          cohort_id: 'cohort',
          course_id: 'course',
          course_type: 'A',
          status: 'finalizado',
          horas_practica_objetivo: 10,
        },
      ],
      error: null,
    });
    from
      .mockReturnValueOnce(
        createChain({ data: { activo: true, debe_cambiar_password: false }, error: null }),
      )
      .mockReturnValueOnce(chain);
    const res = await request(app)
      .get('/estudiantes/practice-history/enrollments')
      .set('Authorization', auth('estudiante'));
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      enrollmentId: enrollment,
      status: 'finalizado',
      horasObjetivo: 10,
    });
    expect(chain.eq).toHaveBeenCalledWith('student_id', 'test-user-id');
  });
});
