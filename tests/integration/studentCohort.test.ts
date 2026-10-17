import request from 'supertest';
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: {}, supabaseAnon: {} }));
jest.mock('../../src/config/jwks', () => ({ verifySupabaseJwt: jest.fn() }));
jest.mock('../../src/config/mailer', () => ({ mailer: { sendMail: jest.fn() } }));
jest.mock('../../src/services/studentCohort.service', () => ({
  StudentCohortService: jest
    .fn()
    .mockImplementation(() => ({ options: jest.fn(), assign: jest.fn() })),
}));
import { createApp } from '../../src/app';
import { verifySupabaseJwt } from '../../src/config/jwks';
import { StudentCohortService } from '../../src/services/studentCohort.service';
import { mockAuthToken } from '../helpers/tokens';
import { AppError } from '../../src/utils/AppError';
const student = '22222222-2222-4222-8222-222222222222',
  enrollment = '33333333-3333-4333-8333-333333333333',
  cohort = '44444444-4444-4444-8444-444444444444';
const base = `/admin/estudiantes/${student}/matriculas/${enrollment}`;
const service = (StudentCohortService as jest.Mock).mock.results[0].value as {
  options: jest.Mock;
  assign: jest.Mock;
};
const app = createApp(),
  verify = verifySupabaseJwt as jest.Mock;
describe('rutas C admin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  it.each(['get', 'post'] as const)('%s requiere sesión y admin', async (method) => {
    const path = base + (method === 'get' ? '/cohortes' : '/asignar-cohorte');
    expect((await request(app)[method](path).send({ cohortId: cohort })).status).toBe(401);
    expect(
      (
        await request(app)
          [method](path)
          .set('Authorization', `Bearer ${mockAuthToken(verify, 'instructor')}`)
          .send({ cohortId: cohort })
      ).status,
    ).toBe(403);
    expect(service.assign).not.toHaveBeenCalled();
    expect(service.options).not.toHaveBeenCalled();
  });
  it('GET delega el alumno y matrícula exactos', async () => {
    service.options.mockResolvedValue({ items: [], suggestion: { cohortId: null } });
    const response = await request(app)
      .get(base + '/cohortes')
      .set('Authorization', `Bearer ${mockAuthToken(verify, 'admin')}`);
    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([]);
    expect(service.options).toHaveBeenCalledWith(student, enrollment);
  });
  it('POST acepta solo cohortId; actor viene de sesión', async () => {
    service.assign.mockResolvedValue({ enrollmentId: enrollment, status: 'activo' });
    const response = await request(app)
      .post(base + '/asignar-cohorte')
      .set('Authorization', `Bearer ${mockAuthToken(verify, 'admin')}`)
      .send({ cohortId: cohort });
    expect(response.status).toBe(200);
    expect(service.assign).toHaveBeenCalledWith(expect.any(String), student, enrollment, cohort);
  });
  it.each([
    {},
    { cohortId: 'invalid' },
    { cohortId: cohort, p_validated_day: '2099-01-01' },
    { cohortId: cohort, actorId: student },
  ])('rechaza entradas y pruebas de ventana del cliente', async (body) => {
    const response = await request(app)
      .post(base + '/asignar-cohorte')
      .set('Authorization', `Bearer ${mockAuthToken(verify, 'admin')}`)
      .send(body);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_FIELD');
    expect(service.assign).not.toHaveBeenCalled();
  });
  it('valida UUID de matrícula y conserva field conocido', async () => {
    const response = await request(app)
      .get(`/admin/estudiantes/${student}/matriculas/invalid/cohortes`)
      .set('Authorization', `Bearer ${mockAuthToken(verify, 'admin')}`);
    expect(response.status).toBe(400);
    expect(response.body.field).toBe('enrollmentId');
  });
  it.each([
    [409, 'COHORT_CHANGED'],
    [409, 'COHORT_FULL'],
    [409, 'DELETION_PENDING'],
    [403, 'ACCOUNT_INACTIVE'],
    [503, 'UNCONFIRMED'],
  ])('conserva %s/%s del servicio', async (status, code) => {
    service.assign.mockRejectedValue(new AppError('Fixture', status, { code: code }));
    const response = await request(app)
      .post(base + '/asignar-cohorte')
      .set('Authorization', `Bearer ${mockAuthToken(verify, 'admin')}`)
      .send({ cohortId: cohort });
    expect(response.status).toBe(status);
    expect(response.body.code).toBe(code);
  });
});
