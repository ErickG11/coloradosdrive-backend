// Límites persistentes tienen su propia suite con RPC reales en memoria.
jest.mock('../../src/middlewares/enrollmentLimits.middleware',()=>({
  reserveEnrollmentCodeIp:(_req:unknown,_res:unknown,next:()=>void)=>{next();},
  reserveEnrollmentCode:(_req:unknown,_res:unknown,next:()=>void)=>{next();},
  reserveEnrollmentUpload:(_req:unknown,_res:unknown,next:()=>void)=>{next();},
}));
import express from 'express';
import request from 'supertest';
import { createApp } from '../../src/app';
import { CaptchaService } from '../../src/services/captcha.service';
import { captchaMiddleware } from '../../src/middlewares/captcha.middleware';
import { errorHandler } from '../../src/middlewares/errorHandler';
import { AppError } from '../../src/utils/AppError';
import { SolicitudService } from '../../src/services/solicitud.service';

test('la ruta real no alcanza el servicio de solicitudes cuando falla captcha', async () => {
  const verify = jest
    .spyOn(CaptchaService.prototype, 'verify')
    .mockRejectedValue(
      new AppError('Completa la verificación de seguridad.', 400, { code: 'CAPTCHA_INVALIDO' }),
    );
  const send = jest
    .spyOn(SolicitudService.prototype, 'verificarCorreo')
    .mockResolvedValue(undefined);
  try {
    const response = await request(createApp())
      .post('/solicitudes/verificar-correo')
      .send({ correo: 'ana@example.invalid', courseId: '10000000-0000-4000-8000-000000000001' });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'CAPTCHA_INVALIDO' });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  } finally {
    verify.mockRestore();
    send.mockRestore();
  }
});
test('middleware solo permite continuar tras verificar y usa IP de Express', async () => {
  const verify = jest.fn().mockResolvedValue(undefined);
  const app = express();
  app.use(express.json());
  app.post('/solicitudes/verificar-correo', captchaMiddleware({ verify }), (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.use(errorHandler);
  expect(
    (
      await request(app)
        .post('/solicitudes/verificar-correo')
        .send({ captchaToken: 'token-ficticio' })
    ).status,
  ).toBe(200);
  expect(verify).toHaveBeenCalledWith('token-ficticio', expect.any(String));
});
