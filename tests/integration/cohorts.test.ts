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

const validCohortBody = {
  courseId: '11111111-1111-4111-8111-111111111111',
  nombre: 'Cohorte Marzo 2026',
  precio: 150,
  cupoMaximo: 20,
  fechaInicio: '2026-03-01',
  fechaFin: '2026-06-01',
};

describe('cohorts endpoints', () => {
  const app = createApp();

  beforeEach(() => {
    mockedFrom.mockReset();
    mockedVerifySupabaseJwt.mockReset();
  });

  describe('protección por autenticación y rol (RNF-03)', () => {
    it('POST /cohorts sin token responde 401', async () => {
      const res = await request(app).post('/cohorts').send(validCohortBody);
      expect(res.status).toBe(401);
    });

    it('POST /cohorts con rol no-admin responde 403', async () => {
      const res = await request(app)
        .post('/cohorts')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`)
        .send(validCohortBody);
      expect(res.status).toBe(403);
    });

    it('GET /cohorts con rol no-admin responde 403', async () => {
      const res = await request(app)
        .get('/cohorts')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'instructor')}`);
      expect(res.status).toBe(403);
    });

    it('PATCH /cohorts/:id con rol no-admin responde 403', async () => {
      const res = await request(app)
        .patch('/cohorts/11111111-1111-4111-8111-111111111111')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'estudiante')}`)
        .send({ nombre: 'Nuevo nombre' });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /cohorts (admin)', () => {
    it('responde 400 si falta un campo requerido', async () => {
      const res = await request(app)
        .post('/cohorts')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
        .send({ ...validCohortBody, courseId: undefined });

      expect(res.status).toBe(400);
      expect(mockedFrom).not.toHaveBeenCalled();
    });

    it('responde 404 si el curso no existe', async () => {
      mockedFrom.mockReturnValueOnce(createChain({ data: null, error: null }));

      const res = await request(app)
        .post('/cohorts')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
        .send(validCohortBody);

      expect(res.status).toBe(404);
    });

    it('crea la cohorte y responde 201', async () => {
      const cohortRow = {
        id: 'cohort-1',
        course_id: validCohortBody.courseId,
        nombre: validCohortBody.nombre,
        precio: '150.00',
        cupo_maximo: validCohortBody.cupoMaximo,
        fecha_inicio: validCohortBody.fechaInicio,
        fecha_fin: validCohortBody.fechaFin,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };

      mockedFrom
        .mockReturnValueOnce(createChain({ data: { id: validCohortBody.courseId }, error: null }))
        .mockReturnValueOnce(createChain({ data: cohortRow, error: null }));

      const res = await request(app)
        .post('/cohorts')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`)
        .send(validCohortBody);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: 'cohort-1',
        nombre: validCohortBody.nombre,
        precio: 150,
      });
    });
  });

  describe('GET /cohorts (admin)', () => {
    it('lista las cohortes', async () => {
      mockedFrom.mockReturnValueOnce(createChain({ data: [], error: null }));

      const res = await request(app)
        .get('/cohorts')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });
});
