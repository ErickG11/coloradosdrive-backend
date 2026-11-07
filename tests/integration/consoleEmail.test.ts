// Límites persistentes tienen su propia suite con RPC reales en memoria.
jest.mock('../../src/middlewares/enrollmentLimits.middleware',()=>({
  reserveEnrollmentCodeIp:(_req:unknown,_res:unknown,next:()=>void)=>{next();},
  reserveEnrollmentCode:(_req:unknown,_res:unknown,next:()=>void)=>{next();},
  reserveEnrollmentUpload:(_req:unknown,_res:unknown,next:()=>void)=>{next();},
}));
import { createHash } from 'node:crypto';

import nodemailer from 'nodemailer';
import request from 'supertest';
import type * as EnvModule from '../../src/config/env';

jest.mock('../../src/config/env', () => {
  const actual = jest.requireActual<typeof EnvModule>('../../src/config/env');
  return {
    ...actual,
    env: { ...actual.env, EMAIL_PROVIDER: 'console', EMAIL_USER: '', EMAIL_APP_PASSWORD: '' },
  };
});
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => {
    throw new Error('SMTP prohibido');
  }),
}));
jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn(),
    rpc: jest.fn(),
    auth: { admin: { createUser: jest.fn(), deleteUser: jest.fn(), getUserById: jest.fn() } },
  },
  supabaseAnon: {},
}));
jest.mock('../../src/config/jwks', () => ({ verifySupabaseJwt: jest.fn() }));

import { createApp } from '../../src/app';
import { supabaseAdmin } from '../../src/config/supabase';
import { mailer } from '../../src/config/mailer';
import { verifySupabaseJwt } from '../../src/config/jwks';
import { EmailService } from '../../src/services/email.service';
import { NotificationEmailService } from '../../src/services/notificationEmail.service';
import { createChain } from '../helpers/supabaseMock';
import { mockAuthToken } from '../helpers/tokens';

const from = supabaseAdmin.from as jest.Mock;
const rpc = supabaseAdmin.rpc as jest.Mock;
const createUser = supabaseAdmin.auth.admin.createUser as jest.Mock;
const getUserById = supabaseAdmin.auth.admin.getUserById as jest.Mock;
const solicitudId = '11111111-1111-4111-8111-111111111111';
const courseId = '55555555-5555-4555-8555-555555555555';
const studentId = '44444444-4444-4444-8444-444444444444';

describe('contratos HTTP y recordatorios con correo por consola real', () => {
  const app = createApp();
  let output: jest.SpyInstance;
  beforeEach(() => {
    from.mockReset();
    rpc.mockReset().mockResolvedValue({ data: false, error: null });
    output = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Red de correo prohibida'));
  });
  afterEach(() => {
    expect(global.fetch).not.toHaveBeenCalled();
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it('verificar-correo responde 200 y muestra el mismo código cuyo hash se guarda',async()=>{
    rpc.mockResolvedValue({data:{emitir:true,id:solicitudId,correo:'ana@example.com'},error:null});
    const res=await request(app).post('/solicitudes/verificar-correo').send({correo:'ana@example.com',courseId});
    expect(res.status).toBe(200);
    const printed=output.mock.calls.map(call=>String(call[0])).join('');
    const code=/verificación es: (\d{6})/.exec(printed)?.[1]??'';
    expect(code).toMatch(/^\d{6}$/);
    expect(rpc.mock.calls[0][1].p_codigo_hash).toBe(createHash('sha256').update(code).digest('hex'));
  });

  // TODO(F23): mock desfasado del flujo de aprobación; reescribir contra POST /admin/solicitudes/:id/decision
  // (aprobación en dos pasos por RPC con enlace de un solo uso en lugar de contraseña temporal).
  it.skip('aprobar responde 200, correoEnviado:true e imprime la contraseña que recibió Auth', async () => {
    from
      .mockReturnValueOnce(
        createChain({
          data: {
            id: solicitudId, enviada_at:'2026-10-01T12:00:00Z',
            course_id: courseId,
            estado: 'pendiente_revision',
            reviewed_at: null,
            cedula: '1710034065',
            nombre_completo: 'Persona Ficticia',
            correo: 'alumna@example.invalid',
            fecha_nacimiento: '1995-05-20',
            correo_verificado: true,
            solicitada_at: '2026-01-02T12:00:00Z',
          },
          error: null,
        }),
      )
      .mockReturnValueOnce(
        createChain({
          data: { id: 'consent', acepto_tratamiento: true, declara_veracidad: true },
          error: null,
        }),
      )
      .mockReturnValueOnce(createChain({ data: { id: solicitudId }, error: null }))
      .mockReturnValueOnce(createChain({ data: null, error: null }))
      .mockReturnValueOnce(createChain({ data: [], error: null }))
      .mockReturnValueOnce(createChain({ data: { id: 'enrollment' }, error: null }));
    createUser.mockResolvedValueOnce({ data: { user: { id: studentId } }, error: null });
    const token = mockAuthToken(verifySupabaseJwt as unknown as jest.Mock, 'admin');
    const res = await request(app)
      .patch(`/admin/solicitudes/${solicitudId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ estado: 'aprobada' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: solicitudId,
      estado: 'aprobada',
      studentId,
      correoEnviado: true,
      cohorteAsignada: { cohortId: null, estado: 'pendiente_cohorte' },
    });
    const password = (createUser.mock.calls[0][0] as { password: string }).password;
    expect(output.mock.calls[0][0]).toContain(`Contraseña temporal: ${password}`);
    expect(output.mock.calls[0][0]).toContain('Correo: alumna@example.invalid');
    expect(JSON.stringify(res.body)).not.toContain(password);
  });

  it.each(['recordatorio_practica', 'sin_practica_instructor'])(
    'confirma %s en la cola con el mismo token y sin error',
    async (tipo) => {
      rpc.mockImplementation((name: string) =>
        name === 'claim_notification_email'
          ? createChain({ data: null, error: null })
          : Promise.resolve({ data: true, error: null }),
      );
      rpc.mockReturnValueOnce(
        createChain({
          data: {
            id: 'notification',
            user_id: studentId,
            tipo,
            scheduled_at: '2099-10-27T20:00:00Z',
            email_lease_token: 'lease',
          },
          error: null,
        }),
      );
      from.mockReturnValueOnce(
        createChain({ data: { activo: true, nombre_completo: 'Persona Ficticia' }, error: null }),
      );
      getUserById.mockResolvedValueOnce({
        data: { user: { email: 'alumna@example.invalid' } },
        error: null,
      });
      await new NotificationEmailService(supabaseAdmin, new EmailService(mailer)).runOnce();
      expect(output).toHaveBeenCalledTimes(1);
      expect(output.mock.calls[0][0]).toContain('[CORREO SIMULADO]');
      expect(rpc).toHaveBeenCalledWith('finish_notification_email', {
        p_id: 'notification',
        p_token: 'lease',
        p_error: null,
      });
    },
  );
});
