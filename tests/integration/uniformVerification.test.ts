import request from 'supertest';
import { performance } from 'node:perf_hooks';
jest.mock('../../src/middlewares/enrollmentLimits.middleware', () => ({
  reserveEnrollmentCodeIp: (_req: unknown, _res: unknown, next: () => void) => {
    next();
  },
  reserveEnrollmentCode: (_req: unknown, _res: unknown, next: () => void) => {
    next();
  },
}));
jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: { from: jest.fn(), rpc: jest.fn() },
  supabaseAnon: {},
}));
jest.mock('../../src/config/mailer', () => ({
  mailer: { sendMail: jest.fn().mockResolvedValue(undefined) },
}));
import { createApp } from '../../src/app';
import { supabaseAdmin } from '../../src/config/supabase';
import { mailer } from '../../src/config/mailer';
import { createChain } from '../helpers/supabaseMock';
import { MENSAJE_VERIFICACION_CORREO } from '../../src/config/enrollmentCatalog';
const app = createApp();
const course = '10000000-0000-4000-8000-000000000001';
afterEach(() => {
  jest.restoreAllMocks();
});
test.each(['nuevo', 'solicitud', 'cuenta', 'error_bd'])(
  'rama real %s conserva HTTP, mensaje y piso',
  async (branch) => {
    const logs = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (mailer.sendMail as jest.Mock).mockClear();
    (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({ data: branch === 'cuenta', error: null });
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) =>
      createChain({
        data:
          table === 'courses'
            ? { id: course }
            : branch === 'solicitud'
              ? { id: '20000000-0000-4000-8000-000000000001', course_id: course, student_id: null }
              : null,
        error:
          branch === 'error_bd'
            ? { code: 'DB_ERROR', message: 'correo/IP ficticios que no deben reflejarse' }
            : null,
      }),
    );
    const start = performance.now();
    const response = await request(app)
      .post('/solicitudes/verificar-correo')
      .send({ correo: 'ana@example.invalid', courseId: course });
    expect(performance.now() - start).toBeGreaterThanOrEqual(295);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: MENSAJE_VERIFICACION_CORREO });
    expect(mailer.sendMail).toHaveBeenCalledTimes(['nuevo', 'solicitud'].includes(branch) ? 1 : 0);
    if (branch === 'error_bd')
      expect(logs).toHaveBeenCalledWith(JSON.stringify({ event: 'verification_request_failed' }));
  },
);
