import request from 'supertest';

jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: { from: jest.fn(), rpc: jest.fn(),
    auth: { admin: { createUser: jest.fn(), deleteUser: jest.fn(), getUserById: jest.fn() } } },
  supabaseAnon: {},
}));
jest.mock('../../src/config/jwks', () => ({ verifySupabaseJwt: jest.fn() }));
jest.mock('../../src/config/mailer', () => ({ mailer: { sendMail: jest.fn() } }));

import { createApp } from '../../src/app';
import { verifySupabaseJwt } from '../../src/config/jwks';
import { supabaseAdmin } from '../../src/config/supabase';
import { createChain } from '../helpers/supabaseMock';
import { mockAuthToken } from '../helpers/tokens';

const from = supabaseAdmin.from as jest.Mock;
const rpc = supabaseAdmin.rpc as jest.Mock;
const verify = verifySupabaseJwt as jest.Mock;
const id = '22222222-2222-4222-8222-222222222222';
const path = `/admin/manual-enrollments/${id}/details`;
const enrollment = {
  id, student_id: '33333333-3333-4333-8333-333333333333', cohort_id: id,
  monto_total: '100.00', descuento: '50.00', monto_abonado: '30.00',
};
const documents = [
  { enrollment_id: id, tipo: 'cedula', estado: 'entregado', fecha_marcado: null, marcado_por: null },
  { enrollment_id: id, tipo: 'papeleta_votacion', estado: 'pendiente', fecha_marcado: null, marcado_por: null },
];

describe('detalles administrativos de matrícula', () => {
  const app = createApp();
  const token = (role: 'admin' | 'estudiante' | 'instructor') =>
    `Bearer ${mockAuthToken(verify, role)}`;
  beforeEach(() => { from.mockReset(); rpc.mockReset(); verify.mockReset(); });

  it.each(['get', 'patch'] as const)('%s exige token y rol admin', async (method) => {
    const call = () => method === 'get' ? request(app).get(path) : request(app).patch(path);
    expect((await call()).status).toBe(401);
    from.mockReturnValueOnce(createChain({ data: { debe_cambiar_password: false }, error: null }));
    expect((await call().set('Authorization', token('estudiante'))).status).toBe(403);
    from.mockReturnValueOnce(createChain({ data: { rol: 'instructor', activo: true,
      debe_cambiar_password: false }, error: null }));
    expect((await call().set('Authorization', token('instructor'))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('lee el monto neto y calcula saldo y documentos pendientes', async () => {
    from.mockReturnValueOnce(createChain({ data: enrollment, error: null }));
    from.mockReturnValueOnce(createChain({ data: documents, error: null }));
    const res = await request(app).get(path).set('Authorization', token('admin'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ montoTotal: 100, precioBruto: 150, descuento: 50,
      montoAbonado: 30, saldo: 70, documentosPendientes: 1 });
  });

  it('mantiene saldo nulo para pendiente de cohorte aunque tenga abono', async () => {
    from.mockReturnValueOnce(createChain({ data: { ...enrollment,
      cohort_id: null, monto_total: null, descuento: '0', monto_abonado: '500' }, error: null }));
    from.mockReturnValueOnce(createChain({ data: documents, error: null }));
    const res = await request(app).get(path).set('Authorization', token('admin'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ montoTotal: null, precioBruto: null,
      montoAbonado: 500, saldo: null });
  });

  it('responde 404 si no existe la matrícula', async () => {
    from.mockReturnValueOnce(createChain({ data: null, error: null }));
    const res = await request(app).get(path).set('Authorization', token('admin'));
    expect(res.status).toBe(404);
  });

  it('actualiza por una sola RPC y devuelve los datos calculados', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    from.mockReturnValueOnce(createChain({ data: enrollment, error: null }));
    from.mockReturnValueOnce(createChain({ data: documents, error: null }));
    const payload = { documentos: [{ tipo: 'cedula', estado: 'entregado' }],
      pago: { modalidad: 'abono', descuento: 50, montoAbonado: 30 } };
    const res = await request(app).patch(path).set('Authorization', token('admin')).send(payload);
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('update_manual_enrollment_details', expect.objectContaining({
      p_enrollment: id, p_documents: payload.documentos, p_payment: payload.pago,
    }));
    expect(res.body).toMatchObject({ saldo: 70, documentosPendientes: 1 });
  });

  it('traduce el rechazo de abono del backend y no consulta datos tras el fallo', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'CD025',
      message: 'El abono no corresponde al monto total neto' } });
    const res = await request(app).patch(path).set('Authorization', token('admin'))
      .send({ pago: { modalidad: 'completo', descuento: 0, montoAbonado: 1 } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/abono/);
    expect(from).not.toHaveBeenCalled();
  });
});
