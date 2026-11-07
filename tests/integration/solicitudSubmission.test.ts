import type * as SolicitudAuthModule from '../../src/middlewares/solicitudAuth.middleware';
import type * as SupabaseMockModule from '../helpers/supabaseMock';
// Estado persistido simulado; firma y scope del token siguen siendo los reales.
const mockState = { estado: 'borrador' };
jest.mock('../../src/middlewares/solicitudAuth.middleware', () => {
  const actual = jest.requireActual<typeof SolicitudAuthModule>(
    '../../src/middlewares/solicitudAuth.middleware',
  );
  const { createChain } = jest.requireActual<typeof SupabaseMockModule>('../helpers/supabaseMock');
  return {
    ...actual,
    authenticateSolicitud: actual.createSolicitudAuth({
      from: () =>
        createChain({ data: { estado: mockState.estado, correo_verificado: true }, error: null }),
    } as unknown as Parameters<typeof actual.createSolicitudAuth>[0]),
  };
});
import request from 'supertest';
jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: { from: jest.fn(), rpc: jest.fn(), storage: { from: jest.fn() } },
  supabaseAnon: {},
}));
jest.mock('../../src/config/mailer', () => ({
  mailer: { sendMail: jest.fn().mockResolvedValue({}) },
}));
jest.mock('../../src/config/jwks', () => ({ verifySupabaseJwt: jest.fn() }));
import { createApp } from '../../src/app';
import { mailer } from '../../src/config/mailer';
import { supabaseAdmin } from '../../src/config/supabase';
import { signSolicitudToken } from '../../src/utils/solicitudToken';
import { createChain } from '../helpers/supabaseMock';

const id = '11111111-1111-4111-8111-111111111111';
const otra = '22222222-2222-4222-8222-222222222222';
const from = supabaseAdmin.from as jest.Mock;
const rpc = supabaseAdmin.rpc as jest.Mock;
const sendMail = mailer.sendMail as jest.Mock;
const app = createApp();
const bearer = (solicitud = id, scope: 'edicion' | 'estado' = 'edicion') =>
  `Bearer ${signSolicitudToken(solicitud, undefined, scope)}`;
const enviadaAt = '2026-11-03T12:00:00Z';
const result = (transicion: boolean) => ({
  data: { id, estado: 'enviada', enviadaAt, transicion },
  error: null,
});

beforeEach(() => {
  mockState.estado = 'borrador';
  sendMail.mockClear();
  from
    .mockReset()
    .mockReturnValue(createChain({ data: { correo: 'ana@example.com' }, error: null }));
  rpc.mockReset().mockResolvedValue(result(true));
});

it.each(['enviar', 'reenviar'])(
  'POST %s responde 200, sin transicion en el cuerpo, y manda un acuse',
  async (accion) => {
    const res = await request(app)
      .post(`/solicitudes/${id}/${accion}`)
      .set('Authorization', bearer());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id, estado: 'enviada', enviadaAt });
    expect(rpc).toHaveBeenCalledWith(
      'enviar_solicitud_inscripcion',
      expect.objectContaining({ p_id: id, p_modo: accion }),
    );
    expect(sendMail).toHaveBeenCalledTimes(1);
  },
);
it('doble envío por HTTP: las dos respuestas son iguales y el acuse sale una sola vez', async () => {
  rpc.mockResolvedValueOnce(result(true)).mockResolvedValueOnce(result(false));
  const first = await request(app).post(`/solicitudes/${id}/enviar`).set('Authorization', bearer());
  mockState.estado = 'enviada';
  const second = await request(app)
    .post(`/solicitudes/${id}/enviar`)
    .set('Authorization', bearer());
  expect([first.status, second.status]).toEqual([200, 200]);
  expect(second.body).toEqual(first.body);
  expect(sendMail).toHaveBeenCalledTimes(1);
});
it('envíos simultáneos con Promise.all solo producen un acuse', async () => {
  rpc.mockReset().mockResolvedValueOnce(result(true)).mockResolvedValue(result(false));
  const results = await Promise.all(
    [1, 2, 3].map(() =>
      request(app).post(`/solicitudes/${id}/enviar`).set('Authorization', bearer()),
    ),
  );
  expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
  expect(sendMail).toHaveBeenCalledTimes(1);
});
it('el certificado faltante llega como SOLICITUD_INCOMPLETA con la lista', async () => {
  rpc.mockResolvedValue({
    data: null,
    error: {
      code: 'SI424',
      message: 'x',
      details: JSON.stringify({ faltantes: ['certificado_estudios'] }),
    },
  });
  const res = await request(app).post(`/solicitudes/${id}/enviar`).set('Authorization', bearer());
  expect(res.status).toBe(400);
  expect(res.body.code).toBe('SOLICITUD_INCOMPLETA');
  expect(res.body.faltantes).toEqual(['certificado_estudios']);
  expect(sendMail).not.toHaveBeenCalled();
});
it('sin token, de otra solicitud o de solo lectura no llega a la RPC', async () => {
  expect((await request(app).post(`/solicitudes/${id}/enviar`)).status).toBe(401);
  expect(
    (await request(app).post(`/solicitudes/${id}/enviar`).set('Authorization', bearer(otra)))
      .status,
  ).toBe(403);
  expect(
    (
      await request(app)
        .post(`/solicitudes/${id}/reenviar`)
        .set('Authorization', bearer(id, 'estado'))
    ).status,
  ).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
});
it.each(['aprobada', 'rechazada'])('estado %s: 409 sin llegar a la RPC', async (estado) => {
  mockState.estado = estado;
  const res = await request(app).post(`/solicitudes/${id}/enviar`).set('Authorization', bearer());
  expect(res.status).toBe(409);
  expect(rpc).not.toHaveBeenCalled();
});
it('una enviada sigue rechazando datos y consentimiento aunque el token sea de edición', async () => {
  mockState.estado = 'enviada';
  const data = await request(app)
    .put(`/solicitudes/${id}/datos`)
    .set('Authorization', bearer())
    .send({});
  const consent = await request(app)
    .put(`/solicitudes/${id}/consentimiento`)
    .set('Authorization', bearer())
    .send({});
  expect([data.status, consent.status]).toEqual([409, 409]);
  expect(data.body.code).toBe('SOLICITUD_ENVIADA');
});
