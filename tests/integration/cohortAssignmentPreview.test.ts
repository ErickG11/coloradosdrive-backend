import request from 'supertest';

jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: { from: jest.fn() },
  supabaseAnon: {},
}));

jest.mock('../../src/config/mailer', () => ({
  mailer: { sendMail: jest.fn().mockResolvedValue({}) },
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

const courseId = '22222222-2222-4222-8222-222222222222';

const cohortRow = {
  id: '11111111-1111-4111-8111-111111111111',
  course_id: courseId,
  nombre: 'Cohorte Marzo',
  precio: '150.00',
  cupo_maximo: 20,
  fecha_inicio_matricula: '2026-09-01',
  fecha_fin_matricula: '2026-12-31',
  fecha_inicio_curso: '2027-01-15',
  created_at: '2025-12-01T00:00:00Z',
};

describe('POST /admin/cohort-assignment/preview', () => {
  const app = createApp();

  beforeEach(() => {
    mockedFrom.mockReset();
    mockedVerifySupabaseJwt.mockReset();
  });

  it('sin token responde 401', async () => {
    const res = await request(app)
      .post('/admin/cohort-assignment/preview')
      .send({ courseId });
    expect(res.status).toBe(401);
  });

  it('con rol no-admin responde 403', async () => {
    const res = await request(app)
      .post('/admin/cohort-assignment/preview')
      .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'instructor')}`)
      .send({ courseId });
    expect(res.status).toBe(403);
    expect(mockedFrom).not.toHaveBeenCalled();
  });

  it('responde 400 si courseId no es un UUID válido', async () => {
    const res = await request(app)
      .post('/admin/cohort-assignment/preview')
      .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
      .send({ courseId: 'no-es-un-uuid' });

    expect(res.status).toBe(400);
    expect(mockedFrom).not.toHaveBeenCalled();
  });

  it('con una cohorte elegible, responde con cohortId, cohortNombre y warning', async () => {
    mockedFrom
      .mockReturnValueOnce(createChain({ data: [cohortRow], error: null })) // cohorts
      .mockReturnValueOnce(createChain({ data: [], error: null })); // enrollments activos (0 ocupados)

    const res = await request(app)
      .post('/admin/cohort-assignment/preview')
      .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
      .send({ courseId });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      cohortId: cohortRow.id,
      cohortNombre: cohortRow.nombre,
      warning: null,
    });
  });

  it('sin ninguna cohorte con matrícula abierta, responde cohortId null con mensaje', async () => {
    mockedFrom.mockReturnValueOnce(createChain({ data: [], error: null })); // cohorts

    const res = await request(app)
      .post('/admin/cohort-assignment/preview')
      .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
      .send({ courseId });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      cohortId: null,
      mensaje: 'ninguna cohorte con matrícula abierta',
    });
  });

  it('no crea ninguna inscripción (solo consulta cohorts y enrollments para contar ocupación)', async () => {
    mockedFrom
      .mockReturnValueOnce(createChain({ data: [cohortRow], error: null }))
      .mockReturnValueOnce(createChain({ data: [], error: null }));

    await request(app)
      .post('/admin/cohort-assignment/preview')
      .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
      .send({ courseId });

    expect(mockedFrom).toHaveBeenCalledTimes(2);
    expect(mockedFrom).not.toHaveBeenCalledWith('users');
  });
});
