import request from 'supertest';
jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: { from: jest.fn(), rpc: jest.fn(), auth: { admin: { updateUserById: jest.fn() } } },
  supabaseAnon: {},
}));
jest.mock('../../src/config/jwks', () => ({ verifySupabaseJwt: jest.fn() }));
jest.mock('../../src/config/mailer', () => ({ mailer: { sendMail: jest.fn() } }));
import { createApp } from '../../src/app';
import { supabaseAdmin } from '../../src/config/supabase';
import { verifySupabaseJwt } from '../../src/config/jwks';
import { createChain } from '../helpers/supabaseMock';
import { mockAuthToken } from '../helpers/tokens';
import { dataRpcCalls } from '../helpers/rpcCalls';

// ADR 027: la verificación de identidad es solo del administrador, sin espera de 48 horas.
const from = supabaseAdmin.from as jest.Mock;
const rpc = supabaseAdmin.rpc as jest.Mock;
const verify = verifySupabaseJwt as jest.Mock;
const student = '22222222-2222-4222-8222-222222222222';
const url = `/admin/estudiantes/${student}/identidad-presencial`;
const result = {
  transicion: true,
  confirmadaAt: '2026-11-16T15:00:00.000Z',
  confirmadaPor: 'test-user-id',
  enrollmentId: 'e',
};

describe('Confirmación de identidad presencial por el administrador', () => {
  const app = createApp();
  beforeEach(() => {
    jest.clearAllMocks();
    from.mockReset();
    rpc.mockReset();
    verify.mockReset();
    from.mockReturnValue(createChain({ data: null, error: null }));
  });

  it.each([['instructor'], ['estudiante']] as const)('rechaza al rol %s sin llegar a la base', async (role) => {
    const res = await request(app)
      .post(url)
      .set('Authorization', `Bearer ${mockAuthToken(verify, role)}`)
      .send({});
    expect(res.status).toBe(403);
    expect(dataRpcCalls(rpc)).toHaveLength(0);
  });

  it('exige autenticación', async () => {
    expect((await request(app).post(url).send({})).status).toBe(401);
  });

  it('el administrador confirma sin motivo y sin esperar plazo alguno', async () => {
    rpc.mockResolvedValue({ data: result, error: null });
    const res = await request(app)
      .post(url)
      .set('Authorization', `Bearer ${mockAuthToken(verify, 'admin')}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ transicion: true });
    expect(rpc).toHaveBeenCalledWith('confirmar_identidad_presencial_admin', {
      p_student: student,
      p_actor: 'test-user-id',
      p_motivo: null,
    });
  });

  it('conserva la observación opcional ya normalizada', async () => {
    rpc.mockResolvedValue({ data: result, error: null });
    await request(app)
      .post(url)
      .set('Authorization', `Bearer ${mockAuthToken(verify, 'admin')}`)
      .send({ motivo: '  Se revisó   la cédula original  ' });
    expect(rpc).toHaveBeenCalledWith(
      'confirmar_identidad_presencial_admin',
      expect.objectContaining({ p_motivo: 'Se revisó la cédula original' }),
    );
  });

  it.each(['corto', 'x'.repeat(301), 42])('rechaza una observación inválida (%s)', async (motivo) => {
    const res = await request(app)
      .post(url)
      .set('Authorization', `Bearer ${mockAuthToken(verify, 'admin')}`)
      .send({ motivo });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'MOTIVO_INVALIDO' });
    expect(dataRpcCalls(rpc)).toHaveLength(0);
  });

  it('rechaza campos que no existen en el cuerpo', async () => {
    const res = await request(app)
      .post(url)
      .set('Authorization', `Bearer ${mockAuthToken(verify, 'admin')}`)
      .send({ cedulaOriginalVista: true });
    expect(res.status).toBe(400);
    expect(dataRpcCalls(rpc)).toHaveLength(0);
  });

  it.each([
    ['IP403', 403, 'ACCESO_DENEGADO'],
    ['IP404', 404, 'ALUMNO_NO_ENCONTRADO'],
    ['IP412', 409, 'ALUMNO_SIN_SOLICITUD'],
    ['IP422', 400, 'MOTIVO_INVALIDO'],
  ])('traduce el error %s de la base', async (code, status, appCode) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: 'x' } });
    const res = await request(app)
      .post(url)
      .set('Authorization', `Bearer ${mockAuthToken(verify, 'admin')}`)
      .send({});
    expect(res.status).toBe(status);
    expect(res.body).toMatchObject({ code: appCode });
  });

  it('un error desconocido no se filtra y responde 503', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'detalle interno' } });
    const res = await request(app)
      .post(url)
      .set('Authorization', `Bearer ${mockAuthToken(verify, 'admin')}`)
      .send({});
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain('detalle interno');
    spy.mockRestore();
  });
});
