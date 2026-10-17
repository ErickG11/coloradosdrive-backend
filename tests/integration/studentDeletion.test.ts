import request from 'supertest';
jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn(),
    rpc: jest.fn(),
    auth: { admin: { updateUserById: jest.fn(), deleteUser: jest.fn() } },
  },
  supabaseAnon: {},
}));
jest.mock('../../src/config/jwks', () => ({ verifySupabaseJwt: jest.fn() }));
jest.mock('../../src/config/mailer', () => ({ mailer: { sendMail: jest.fn() } }));
import { createApp } from '../../src/app';
import { supabaseAdmin } from '../../src/config/supabase';
import { verifySupabaseJwt } from '../../src/config/jwks';
import { createChain } from '../helpers/supabaseMock';
import { mockAuthToken } from '../helpers/tokens';
const id = '22222222-2222-4222-8222-222222222222',
  path = '/admin/estudiantes';
const rpc = supabaseAdmin.rpc as jest.Mock,
  from = supabaseAdmin.from as jest.Mock,
  verify = verifySupabaseJwt as jest.Mock;
const token = (role: 'admin' | 'instructor' = 'admin') => 'Bearer ' + mockAuthToken(verify, role);
describe('D endpoints solo admin', () => {
  const app = createApp();
  beforeEach(() => {
    jest.clearAllMocks();
    rpc.mockReset();
    from.mockReset();
    verify.mockReset();
  });
  it.each(['post', 'get'] as const)('%s exige autenticación y rol admin', async (method) => {
    const call = () =>
      method === 'post'
        ? request(app).post(`${path}/${id}/eliminar`).send({})
        : request(app).get(`${path}/eliminaciones`);
    expect((await call()).status).toBe(401);
    expect((await call().set('Authorization', token('instructor'))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
  it.each([
    { confirmacionCedula: 123 },
    { confirmacionCedula: 'x' },
    { confirmacionCedula: null },
    { cedula: '1710034065' },
    [],
    null,
  ])('rechaza cuerpo inválido sin efectos: %p', async (body) => {
    const res = await request(app)
      .post(`${path}/${id}/eliminar`)
      .set('Authorization', token())
      .set('Content-Type', 'application/json')
      .send(body ?? 'null');
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([{ confirmacionCedula: '1710034065' }, {}])(
    'pasa confirmación o reanudación a RPC: %p',
    async (body) => {
      rpc.mockResolvedValue({
        data: { student_id: id, phase: 'completo', status: 'completo' },
        error: null,
      });
      const res = await request(app)
        .post(`${path}/${id}/eliminar`)
        .set('Authorization', token())
        .send(body);
      expect(res.status).toBe(200);
      expect(rpc).toHaveBeenCalledWith(
        'begin_student_deletion',
        expect.objectContaining({
          p_student: id,
          p_confirmation: 'confirmacionCedula' in body ? body.confirmacionCedula : null,
        }),
      );
    },
  );
  it('confirmación vacía no inicia operación nueva; mensaje no refleja la cédula', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'CD031' } });
    const res = await request(app)
      .post(`${path}/${id}/eliminar`)
      .set('Authorization', token())
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_CONFIRMATION');
  });
  it.each([
    `${path}/${id}/eliminar`,
    `${path}/${id}/eliminar/`,
    `${path}/${id}/eliminar`.toUpperCase(),
  ])('JSON malformado no filtra ni registra el body del parser: %s', async (route) => {
    const log = jest.spyOn(console, 'error').mockImplementation();
    try {
      const res = await request(app)
        .post(route)
        .set('Content-Type', 'application/json')
        .send('{"confirmacionCedula":"1710034065",');
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain('1710034065');
      expect(JSON.stringify(log.mock.calls)).not.toContain('1710034065');
      expect(rpc).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
  it('ruta estática lista sin consultar users; filtra estado y pagina', async () => {
    const chain = createChain({
      data: [{ student_id: id, phase: 'auth', status: 'fallido' }],
      count: 1,
      error: null,
    });
    from.mockReturnValue(chain);
    const res = await request(app)
      .get(`${path}/eliminaciones`)
      .query({ page: 2, pageSize: 3, estado: 'fallido' })
      .set('Authorization', token());
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(from).toHaveBeenCalledWith('student_deletion_operations');
    expect(from).toHaveBeenCalledTimes(1);
    expect(chain.in).toHaveBeenCalledWith('status', ['fallido']);
    expect(chain.range).toHaveBeenCalledWith(3, 5);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([{ page: 0 }, { pageSize: 101 }, { estado: 'completo' }, { q: 'no-permitido' }])(
    'valida filtros: %p',
    async (query) => {
      expect(
        (await request(app).get(`${path}/eliminaciones`).query(query).set('Authorization', token()))
          .status,
      ).toBe(400);
      expect(from).not.toHaveBeenCalled();
    },
  );
});
