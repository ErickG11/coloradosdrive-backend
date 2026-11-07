import { paymentWithWelcome } from '../services/paymentWelcome';
import { Router, type Request } from 'express';
import { body, param, matchedData, type ValidationChain } from 'express-validator';
import { env } from '../config/env';
import { supabaseAdmin } from '../config/supabase';
import { validateFields } from '../middlewares/validate';
import { buildRateLimiter } from '../middlewares/rateLimit';
import { StudentPaymentService, paymentView } from '../services/studentPayment.service';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { createHmac } from 'node:crypto';
export const studentPaymentRouter = Router();
export const paymentService = new StudentPaymentService(supabaseAdmin, env);
function subject(req: Request): string {
  if (!req.user) throw new AppError('Inicia sesión nuevamente.', 401, { code: 'SESION_REQUERIDA' });
  return req.user.id;
}
export function paymentRateKey(req: Request): string {
  return createHmac('sha256', env.ENROLLMENT_RATE_HMAC_SECRET)
    .update(`payment:${subject(req)}`)
    .digest('hex');
}
const readLimit = buildRateLimiter(180, env.NODE_ENV === 'test', paymentRateKey);
const writeLimit = buildRateLimiter(15, env.NODE_ENV === 'test', paymentRateKey);
export function strictPaymentBody(keys: string[]): ValidationChain {
  return body()
    .custom(
      (v: unknown) =>
        !!v &&
        typeof v === 'object' &&
        !Array.isArray(v) &&
        Object.keys(v).every((k) => keys.includes(k)),
    )
    .withMessage('El pago contiene campos no permitidos.');
}
const id = (): ValidationChain => param('id').isUUID().withMessage('Selecciona un pago válido.');
studentPaymentRouter.use((req, _res, next) => {
  if (Object.keys(req.query).length) {
    next(new AppError('No se admiten parámetros.', 400, { code: 'INVALID_FIELD' }));
    return;
  }
  next();
});
studentPaymentRouter.get('/config', readLimit, (_req, res) =>
  res.json({
    proveedor: env.PAYMENT_PROVIDER,
    publicKey: env.PAYMENT_PROVIDER === 'kushki' ? env.KUSHKI_PUBLIC_KEY : null,
    inTest: env.KUSHKI_ENVIRONMENT === 'uat',
  }),
);
studentPaymentRouter.get(
  '/matricula/:id/actual',
  readLimit,
  [id()],
  validateFields,
  asyncHandler(async (req, res) => {
    const { id: enrollmentId } = matchedData<{ id: string }>(req);
    const pago = await paymentService.current(subject(req), enrollmentId);
    res.json({ pago: pago ? await paymentWithWelcome(pago) : null });
  }),
);
studentPaymentRouter.get(
  '/actual',
  readLimit,
  asyncHandler(async (req, res) => {
    const pago = await paymentService.current(subject(req));
    res.json({ pago: pago ? await paymentWithWelcome(pago) : null });
  }),
);
studentPaymentRouter.get(
  '/reserva/:id/cotizacion',
  readLimit,
  [id()],
  validateFields,
  asyncHandler(async (req, res) => {
    const data = matchedData<{ id: string }>(req);
    res.json(await paymentService.quote(subject(req), data.id));
  }),
);
studentPaymentRouter.post(
  '/',
  writeLimit,
  [
    strictPaymentBody(['reservationId', 'attemptKey']),
    body('reservationId').isUUID().withMessage('Selecciona una reserva válida.'),
    body('attemptKey').isUUID().withMessage('El intento no es válido.'),
  ],
  validateFields,
  asyncHandler(async (req, res) => {
    const data = matchedData<{ reservationId: string; attemptKey: string }>(req);
    res
      .status(201)
      .json(await paymentService.begin(subject(req), data.reservationId, data.attemptKey));
  }),
);
studentPaymentRouter.get(
  '/:id',
  readLimit,
  [id()],
  validateFields,
  asyncHandler(async (req, res) => {
    const data = matchedData<{ id: string }>(req);
    res.json(
      await paymentWithWelcome(paymentView(await paymentService.own(subject(req), data.id))),
    );
  }),
);
studentPaymentRouter.post(
  '/:id/simular',
  writeLimit,
  [
    id(),
    strictPaymentBody(['resultado']),
    body('resultado')
      .isIn(['aprobado', 'rechazado', 'pendiente'])
      .withMessage('Selecciona un resultado válido.'),
  ],
  validateFields,
  asyncHandler(async (req, res) => {
    const data = matchedData<{ id: string; resultado: 'aprobado' | 'rechazado' | 'pendiente' }>(
      req,
    );
    res.json(
      await paymentWithWelcome(
        await paymentService.simulate(subject(req), data.id, data.resultado),
      ),
    );
  }),
);
studentPaymentRouter.post(
  '/:id/cobrar',
  writeLimit,
  [
    id(),
    strictPaymentBody(['token']),
    body('token')
      .isString()
      .bail()
      .matches(/^(?=.*[A-Za-z])[A-Za-z0-9_-]{20,256}$/)
      .withMessage('Completa la tokenización de la tarjeta.'),
  ],
  validateFields,
  asyncHandler(async (req, res) => {
    const data = matchedData<{ id: string; token: string }>(req);
    res.status(202).json(await paymentService.charge(subject(req), data.id, data.token));
  }),
);
