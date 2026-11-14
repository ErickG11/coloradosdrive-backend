import request from 'supertest';
jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: { from: jest.fn(), rpc: jest.fn(), storage: { from: jest.fn() } },
  supabaseAnon: {},
}));
jest.mock('../../src/config/mailer', () => ({ mailer: { sendMail: jest.fn() } }));
jest.mock('../../src/config/jwks', () => ({ verifySupabaseJwt: jest.fn() }));
import { createApp } from '../../src/app';
import { supabaseAdmin } from '../../src/config/supabase';
import { verifySupabaseJwt } from '../../src/config/jwks';
import { SolicitudService } from '../../src/services/solicitud.service';
import { createChain } from '../helpers/supabaseMock';
import { dataRpcCalls } from '../helpers/rpcCalls';
const from = supabaseAdmin.from as jest.Mock,
  rpc = supabaseAdmin.rpc as jest.Mock,
  jwt = verifySupabaseJwt as jest.Mock;
const admin = '10000000-0000-4000-8000-000000000001',
  course = '20000000-0000-4000-8000-000000000001';
const app = createApp();
beforeEach(() => {
  jest.restoreAllMocks();
  from.mockReset();
  rpc.mockReset();
  jwt.mockReset();
  jwt.mockResolvedValue({ sub: admin, app_metadata: { role: 'admin' } });
  from.mockImplementation((table: string) =>
    createChain({
      data:
        table === 'courses'
          ? [{ id: course, tipo: 'B', nombre: 'Curso', edad_minima: 18 }]
          : table === 'users'
            ? { activo: true, debe_cambiar_password: false, rol: 'instructor' }
            : table === 'enrollments'
              ? [] // alumno sin matrículas de solicitud pendientes
              : { inscripciones_abiertas: true },
      error: null,
    }),
  );
  rpc.mockImplementation((name: string) =>
    Promise.resolve({
      data:
        name === 'resumen_solicitudes'
          ? {
              pendientes: 1,
              devueltas: 2,
              conMasDe48h: 0,
              inscripcionesAbiertas: true,
              contadoresHoy: { codigos: 200 },
            }
          : name === 'actualizar_config_inscripcion'
            ? { inscripcionesAbiertas: false }
            : { permitido: true },
      error: null,
    }),
  );
});
test('config pública exacta, sin sesión ni secretos, y no-store', async () => {
  const res = await request(app).get('/public/inscripcion/config');
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({
    inscripcionesAbiertas: true,
    cursos: [{ id: course, tipo: 'B', nombre: 'Curso', edadMinima: 18 }],
    captcha: { provider: 'off', siteKey: null },
  });
  expect(res.body).not.toHaveProperty('SUPABASE_SERVICE_ROLE_KEY');
  expect(res.headers['cache-control']).toBe('no-store');
});
test.each(['get', 'put'] as const)('config admin %s exige sesión', async (method) => {
  const res = await request(app)
    [method]('/admin/inscripciones/config')
    .send({ inscripcionesAbiertas: false });
  expect(res.status).toBe(401);
});
test.each(['estudiante', 'instructor'])('config admin rechaza rol %s', async (role) => {
  jwt.mockResolvedValue({ sub: admin, app_metadata: { role } });
  const res = await request(app)
    .put('/admin/inscripciones/config')
    .set('Authorization', 'Bearer ficticio')
    .send({ inscripcionesAbiertas: false });
  expect(res.status).toBe(403);
  expect(dataRpcCalls(rpc)).toHaveLength(0);
});
test('admin actualiza mediante RPC auditada con actor de JWT', async () => {
  const res = await request(app)
    .put('/admin/inscripciones/config')
    .set('Authorization', 'Bearer ficticio')
    .send({ inscripcionesAbiertas: false });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ inscripcionesAbiertas: false });
  expect(rpc).toHaveBeenCalledWith('actualizar_config_inscripcion', {
    p_actor: admin,
    p_abiertas: false,
  });
});
test('rechaza mass assignment en configuración', async () => {
  const res = await request(app)
    .put('/admin/inscripciones/config')
    .set('Authorization', 'Bearer ficticio')
    .send({ inscripcionesAbiertas: false, updated_by: 'otro' });
  expect(res.status).toBe(400);
  expect(dataRpcCalls(rpc)).toHaveLength(0);
});
test('resumen autenticado expone alertas del 80% y elimina contador documental', async () => {
  const res = await request(app)
    .get('/admin/solicitudes/resumen')
    .set('Authorization', 'Bearer ficticio');
  expect(res.status).toBe(200);
  expect(res.body.alertas).toContain('codigos');
  expect(res.body.cupoCodigosHoy).toEqual({ usado: 200, tope: 250, alerta: true });
  expect(res.body).not.toHaveProperty('documentosPorRevisar');
});
test.each([
  ['cerradas', 503, 'INSCRIPCIONES_CERRADAS'],
  ['limite', 429, 'CUPO_DIARIO_AGOTADO'],
])('verificar-correo rechaza %s antes de enviar', async (motivo, status, code) => {
  const send = jest
    .spyOn(SolicitudService.prototype, 'verificarCorreo')
    .mockResolvedValue(undefined);
  rpc.mockResolvedValue({ data: { permitido: false, motivo }, error: null });
  const res = await request(app)
    .post('/solicitudes/verificar-correo')
    .send({ correo: 'ana@example.invalid', courseId: course });
  expect(res.status).toBe(status);
  expect(res.body.code).toBe(code);
  expect(send).not.toHaveBeenCalled();
});
test('verificar-correo reserva IP y código con claves HMAC sin store de memoria ni omisión en test', async () => {
  const send = jest
    .spyOn(SolicitudService.prototype, 'verificarCorreo')
    .mockResolvedValue(undefined);
  const res = await request(app)
    .post('/solicitudes/verificar-correo')
    .send({ correo: 'ANA@EXAMPLE.INVALID', courseId: course });
  expect(res.status).toBe(200);
  expect(send).toHaveBeenCalledTimes(1);
  expect(rpc.mock.calls.map((c) => String(c[1].p_operacion))).toEqual(['codigo_ip', 'codigo']);
  expect(JSON.stringify(rpc.mock.calls)).not.toContain('ana@example.invalid');
});
