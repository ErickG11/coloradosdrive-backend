import request from 'supertest';

jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: { from: jest.fn(), rpc: jest.fn() },
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
const mockedRpc = supabaseAdmin.rpc as jest.Mock;
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
    mockedRpc.mockReset();
    // Ocupación (matrículas activas y reservas vigentes) por RPC: sin ocupados por defecto.
    mockedRpc.mockResolvedValue({ data: [], error: null });
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
    mockedFrom.mockReturnValueOnce(createChain({ data: [cohortRow], error: null })); // cohorts

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

  it('sin ninguna cohorte con cupo y margen de cinco días, responde cohortId null con mensaje', async () => {
    mockedFrom.mockReturnValueOnce(createChain({ data: [], error: null })); // cohorts

    const res = await request(app)
      .post('/admin/cohort-assignment/preview')
      .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
      .send({ courseId });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      cohortId: null,
      mensaje: 'ninguna cohorte con cupo y margen de cinco días',
    });
  });

  it('no crea ninguna inscripción (solo consulta cohorts y los cupos ocupados por RPC)', async () => {
    mockedFrom.mockReturnValueOnce(createChain({ data: [cohortRow], error: null }));

    await request(app)
      .post('/admin/cohort-assignment/preview')
      .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
      .send({ courseId });

    expect(mockedFrom).toHaveBeenCalledTimes(1);
    expect(mockedFrom).toHaveBeenCalledWith('cohorts');
    expect(mockedRpc).toHaveBeenCalledWith('cohort_cupos_ocupados', { p_cohorts: [cohortRow.id] });
    expect(mockedFrom).not.toHaveBeenCalledWith('users');
  });
});
