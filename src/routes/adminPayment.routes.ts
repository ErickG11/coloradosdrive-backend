import { Router } from 'express';
import { body, param, matchedData } from 'express-validator';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validateFields } from '../middlewares/validate';
import { buildRateLimiter } from '../middlewares/rateLimit';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { throwStudentPaymentError } from '../utils/studentPaymentError';
import { supabaseAdmin } from '../config/supabase';
import { env } from '../config/env';
import { paymentService, strictPaymentBody, paymentRateKey } from './studentPayment.routes';
export const adminPaymentRouter = Router();
adminPaymentRouter.use(asyncHandler(authenticate), requireRole('admin'));
adminPaymentRouter.use((req, _res, next) => {
  if (Object.keys(req.query).length) {
    next(new AppError('No se admiten parámetros.', 400, { code: 'INVALID_FIELD' }));
    return;
  }
  next();
});
adminPaymentRouter.use(buildRateLimiter(60, env.NODE_ENV === 'test', paymentRateKey));
adminPaymentRouter.get(
  '/alumnos/:id',
  [param('id').isUUID().withMessage('Selecciona un alumno válido.')],
  validateFields,
  asyncHandler(async (req, res) => {
    const data = matchedData<{ id: string }>(req);
    const [payments, reservation] = await Promise.all([
      supabaseAdmin
        .from('payments')
        .select()
        .eq('student_id', data.id)
        .order('created_at', { ascending: false })
        .limit(100),
      supabaseAdmin
        .from('student_schedule_reservations')
        .select()
        .eq('student_id', data.id)
        .order('creada_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (payments.error || reservation.error)
      throwStudentPaymentError(payments.error ?? reservation.error);
    res.json({ pagos: payments.data, reserva: reservation.data });
  }),
);
adminPaymentRouter.post(
  '/efectivo',
  [
    strictPaymentBody(['studentId', 'reservationId', 'attemptKey', 'comprobante']),
    body('studentId').isUUID().withMessage('Selecciona un alumno válido.'),
    body('reservationId').isUUID().withMessage('Selecciona una reserva válida.'),
    body('attemptKey').isUUID().withMessage('El intento no es válido.'),
    body('comprobante')
      .optional()
      .isString()
      .withMessage('La referencia del comprobante debe ser texto.')
      .bail()
      .trim()
      .isLength({ max: 160 })
      .withMessage('La referencia del comprobante admite hasta160 caracteres.')
      .bail()
      .customSanitizer((value: string) =>
        value
          .normalize('NFC')
          .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
      ),
  ],
  validateFields,
  asyncHandler(async (req, res) => {
    if (!req.user) throw new AppError('Inicia sesión nuevamente.', 401);
    const data = matchedData<{
      studentId: string;
      reservationId: string;
      attemptKey: string;
      comprobante?: string;
    }>(req);
    res.json(
      await paymentService.cash(
        req.user.id,
        data.studentId,
        data.reservationId,
        data.attemptKey,
        data.comprobante,
      ),
    );
  }),
);
adminPaymentRouter.post(
  '/reservas/:id/liberar',
  [param('id').isUUID().withMessage('Selecciona una reserva válida.'), strictPaymentBody([])],
  validateFields,
  asyncHandler(async (req, res) => {
    if (!req.user) throw new AppError('Inicia sesión nuevamente.', 401);
    const data = matchedData<{ id: string }>(req);
    await paymentService.release(req.user.id, data.id);
    res.status(204).send();
  }),
);
