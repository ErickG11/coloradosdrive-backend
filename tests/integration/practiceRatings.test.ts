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

const app = createApp();
const rpc = supabaseAdmin.rpc as jest.Mock;
const from = supabaseAdmin.from as jest.Mock;
const verify = verifySupabaseJwt as jest.Mock;
const slot = '11111111-1111-4111-8111-111111111111';
const instructor = '22222222-2222-4222-8222-222222222222';
const auth = (role: 'estudiante' | 'admin' | 'instructor') =>
  `Bearer ${mockAuthToken(verify, role)}`;
const pending = '/estudiantes/practice-ratings/pending';
const submit = '/estudiantes/practice-ratings';
const ranking = '/admin/instructor-ratings';
const detail = `${ranking}/${instructor}`;
const submission = { practiceSlotId: slot, score: 5, comment: 'Excelente' };
const pendingData = {
  items: [
    {
      practiceSlotId: slot,
      instructorName: 'Instructor',
      scheduledAt: '2026-10-27T10:00:00Z',
      opensAt: '2026-10-27T11:05:00Z',
      closesAt: '2026-10-28T11:05:00Z',
      studentId: 'private',
    },
  ],
  total: 1,
  page: 2,
  pageSize: 1,
};
const submitData = {
  id: 'rating-id',
  ...submission,
  createdAt: '2026-10-27T11:10:00Z',
  studentId: 'private',
};
const rankingData = {
  items: [
    {
      instructorId: instructor,
      instructorName: 'Instructor',
      active: true,
      average: 4.5,
      responses: 4,
      rankingEligible: true,
      label: null,
      studentId: 'private',
    },
  ],
  total: 1,
  page: 2,
  pageSize: 1,
};
const detailData = {
  instructorId: instructor,
  average: 4.5,
  responses: 4,
  rankingEligible: true,
  label: null,
  items: [
    { score: 5, comment: 'Bien', studentId: 'private', practiceSlotId: slot, createdAt: 'private' },
  ],
  total: 4,
  page: 2,
  pageSize: 1,
  studentId: 'private',
};

type Route = 'pending' | 'submit' | 'ranking' | 'detail';
const routes: Route[] = ['pending', 'submit', 'ranking', 'detail'];
const endpoint = (route: Route) => ({ pending, submit, ranking, detail })[route];
const role = (route: Route) => (route === 'pending' || route === 'submit' ? 'estudiante' : 'admin');
const call = (route: Route, token?: string) => {
  const req =
    route === 'submit'
      ? request(app).post(submit).send(submission)
      : request(app).get(endpoint(route));
  return token ? req.set('Authorization', token) : req;
};

describe('RF-04: rutas de calificación', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    rpc.mockReset();
    from.mockReset();
    from.mockReturnValue(
      createChain({
        data: { activo: true, rol: 'instructor', debe_cambiar_password: false },
        error: null,
      }),
    );
  });

  it('lista ventanas pendientes paginadas del alumno del JWT', async () => {
    rpc.mockResolvedValue({ data: pendingData, error: null });
    const res = await request(app)
      .get(`${pending}?page=2&pageSize=1&studentId=otro`)
      .set('Authorization', auth('estudiante'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ...pendingData,
      items: [
        {
          practiceSlotId: slot,
          instructorName: 'Instructor',
          scheduledAt: '2026-10-27T10:00:00Z',
          opensAt: '2026-10-27T11:05:00Z',
          closesAt: '2026-10-28T11:05:00Z',
        },
      ],
    });
    expect(rpc).toHaveBeenCalledWith('list_student_pending_practice_ratings', {
      p_student: 'test-user-id',
      p_page: 2,
      p_page_size: 1,
    });
  });

  it('envía una respuesta recortada; ignora identidades del body', async () => {
    rpc.mockResolvedValue({ data: submitData, error: null });
    const res = await request(app)
      .post(submit)
      .set('Authorization', auth('estudiante'))
      .send({ ...submission, comment: '  Excelente  ', studentId: 'otro', actorId: 'otro' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: 'rating-id',
      practiceSlotId: slot,
      score: 5,
      comment: 'Excelente',
      createdAt: submitData.createdAt,
    });
    expect(rpc).toHaveBeenCalledWith('submit_practice_rating', {
      p_slot: slot,
      p_student: 'test-user-id',
      p_score: 5,
      p_comment: 'Excelente',
    });
  });

  it('envía comentario omitido como null', async () => {
    rpc.mockResolvedValue({ data: { ...submitData, comment: null }, error: null });
    const res = await request(app)
      .post(submit)
      .set('Authorization', auth('estudiante'))
      .send({ practiceSlotId: slot, score: 1 });
    expect(res.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith(
      'submit_practice_rating',
      expect.objectContaining({ p_comment: null }),
    );
  });

  it('lista el ranking administrativo paginado', async () => {
    rpc.mockResolvedValue({ data: rankingData, error: null });
    const res = await request(app)
      .get(`${ranking}?page=2&pageSize=1`)
      .set('Authorization', auth('admin'));
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toEqual({
      instructorId: instructor,
      instructorName: 'Instructor',
      active: true,
      average: 4.5,
      responses: 4,
      rankingEligible: true,
      label: null,
    });
    expect(res.body).toMatchObject({ total: 1, page: 2, pageSize: 1 });
    expect(rpc).toHaveBeenCalledWith('list_admin_instructor_ratings', {
      p_actor: 'test-user-id',
      p_page: 2,
      p_page_size: 1,
    });
  });

  it('devuelve el detalle administrativo sin identificadores del alumno ni de la práctica', async () => {
    rpc.mockResolvedValue({ data: detailData, error: null });
    const res = await request(app)
      .get(`${detail}?page=2&pageSize=1`)
      .set('Authorization', auth('admin'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      instructorId: instructor,
      average: 4.5,
      responses: 4,
      rankingEligible: true,
      label: null,
      items: [{ score: 5, comment: 'Bien' }],
      total: 4,
      page: 2,
      pageSize: 1,
    });
    expect(rpc).toHaveBeenCalledWith('admin_instructor_rating_detail', {
      p_actor: 'test-user-id',
      p_instructor: instructor,
      p_page: 2,
      p_page_size: 1,
    });
  });

  it.each(['pending', 'ranking', 'detail'] as const)(
    '%s usa paginación 1/20 por defecto',
    async (route) => {
      const data =
        route === 'pending' ? pendingData : route === 'ranking' ? rankingData : detailData;
      rpc.mockResolvedValue({ data, error: null });
      const res = await call(route, auth(role(route)));
      expect(res.status).toBe(200);
      expect(rpc).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ p_page: 1, p_page_size: 20 }),
      );
    },
  );

  it.each(['pending', 'ranking', 'detail'] as const)(
    '%s valida cada parámetro de paginación',
    async (route) => {
      for (const [query, field] of [
        ['page=0', 'page'],
        ['page=1000001', 'page'],
        ['page=1.5', 'page'],
        ['page=x', 'page'],
        ['page=1&page=2', 'page'],
        ['pageSize=0', 'pageSize'],
        ['pageSize=101', 'pageSize'],
        ['pageSize=1.5', 'pageSize'],
        ['pageSize=x', 'pageSize'],
        ['pageSize=1&pageSize=2', 'pageSize'],
      ]) {
        const res = await request(app)
          .get(`${endpoint(route)}?${query}`)
          .set('Authorization', auth(role(route)));
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ code: 'INVALID_FIELD', field });
      }
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, null, 'bad', 4])('valida practiceSlotId %p', async (practiceSlotId) => {
    const res = await request(app)
      .post(submit)
      .set('Authorization', auth('estudiante'))
      .send({ ...submission, practiceSlotId });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'INVALID_FIELD', field: 'practiceSlotId' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 0, 6, 1.5, '5', true])('valida score %p', async (score) => {
    const res = await request(app)
      .post(submit)
      .set('Authorization', auth('estudiante'))
      .send({ ...submission, score });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'INVALID_FIELD', field: 'score' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([null, 42, ['texto'], 'x'.repeat(1001)])('valida comment %p', async (comment) => {
    const res = await request(app)
      .post(submit)
      .set('Authorization', auth('estudiante'))
      .send({ ...submission, comment });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'INVALID_FIELD', field: 'comment' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('acepta exactamente 1000 caracteres después de recortar', async () => {
    rpc.mockResolvedValue({ data: submitData, error: null });
    const res = await request(app)
      .post(submit)
      .set('Authorization', auth('estudiante'))
      .send({ ...submission, comment: ` ${'x'.repeat(1000)} ` });
    expect(res.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith(
      'submit_practice_rating',
      expect.objectContaining({ p_comment: 'x'.repeat(1000) }),
    );
  });

  it('valida instructorId UUID', async () => {
    const res = await request(app).get(`${ranking}/no-uuid`).set('Authorization', auth('admin'));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'INVALID_FIELD', field: 'instructorId' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(routes)('%s rechaza peticiones sin sesión', async (route) => {
    expect((await call(route)).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(['pending', 'submit'] as const)('%s rechaza admin e instructor', async (route) => {
    for (const denied of ['admin', 'instructor'] as const) {
      expect((await call(route, auth(denied))).status).toBe(403);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(['ranking', 'detail'] as const)('%s rechaza alumno e instructor', async (route) => {
    for (const denied of ['estudiante', 'instructor'] as const) {
      expect((await call(route, auth(denied))).status).toBe(403);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(routes)('%s mapea cada código SQL y no filtra errores internos', async (route) => {
    for (const [sqlCode, status, code] of [
      ['RT403', 403, 'RATING_FORBIDDEN'],
      ['RT404', 404, route === 'detail' ? 'INSTRUCTOR_NOT_FOUND' : 'PRACTICE_NOT_FOUND'],
      ['RT409', 409, 'RATING_ALREADY_SUBMITTED'],
      ['RT410', 409, 'RATING_WINDOW_CLOSED'],
      ['RT412', 409, 'RATING_NOT_ELIGIBLE'],
      ['22023', 400, 'INVALID_FIELD'],
      ['CD030', 409, 'DELETION_PENDING'],
      ['UNEXPECTED', 500, undefined],
    ] as const) {
      rpc.mockResolvedValueOnce({
        data: null,
        error: {
          code: sqlCode,
          message: 'secreto interno del alumno y comentario',
          details: 'secreto interno',
        },
      });
      const res = await call(route, auth(role(route)));
      expect(res.status).toBe(status);
      expect(res.body.code).toBe(code);
      expect(JSON.stringify(res.body)).not.toContain('secreto interno');
    }
  });

  it('no registra el comentario cuando el JSON está mal formado', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const res = await request(app)
        .post(submit)
        .set('Authorization', auth('estudiante'))
        .set('Content-Type', 'application/json')
        .send('{"comment":"secreto del alumno",');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_FIELD');
      expect(JSON.stringify(log.mock.calls)).not.toContain('secreto del alumno');
      expect(rpc).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
