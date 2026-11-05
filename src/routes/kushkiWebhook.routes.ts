import { Router } from 'express';
import { env } from '../config/env';
import { supabaseAdmin } from '../config/supabase';
import { buildRateLimiter } from '../middlewares/rateLimit';
import { asyncHandler } from '../utils/asyncHandler';
import { verifyKushkiWebhook } from '../services/payments/kushkiWebhook';
import { throwStudentPaymentError } from '../utils/studentPaymentError';
export const kushkiWebhookRouter = Router();
kushkiWebhookRouter.post(
  '/',
  buildRateLimiter(180, env.NODE_ENV === 'test'),
  asyncHandler(async (req, res) => {
    const event = verifyKushkiWebhook(
      env,
      {
        key: req.get('X-Kushki-Key'),
        id: req.get('X-Kushki-Id'),
        signature: req.get('X-Kushki-Signature'),
      },
      req.body,
    );
    const result = await supabaseAdmin.rpc('confirm_student_payment', {
      p_id: event.id,
      p_proveedor: 'kushki',
      p_referencia: event.reference,
      p_resultado: event.result,
      p_total: event.total,
      p_moneda: event.currency,
      p_event: event.event,
      p_hash: event.hash,
    });
    if (result.error) throwStudentPaymentError(result.error);
    res.json({ recibido: true });
  }),
);
