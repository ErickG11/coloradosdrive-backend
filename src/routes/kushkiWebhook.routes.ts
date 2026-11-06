import { paymentWelcome } from '../services/paymentWelcome';
import { Router } from 'express';
import { env } from '../config/env';
import { supabaseAdmin } from '../config/supabase';
import { buildRateLimiter } from '../middlewares/rateLimit';
import { asyncHandler } from '../utils/asyncHandler';
import { correlateKushkiPayment, verifyKushkiWebhook } from '../services/payments/kushkiWebhook';
import { throwStudentPaymentError } from '../utils/studentPaymentError';
import { logSafeError } from '../utils/safeLog';
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
    const paymentId = await correlateKushkiPayment(supabaseAdmin, event);
    if (!paymentId) {
      // Ni payload, UUID, ticket ni datos del cliente en el registro. No escribir
      // nada en BD; 202 conserva los reintentos del proveedor (éxito: 200/201).
      logSafeError('kushki_webhook_no_correlacionado');
      res.status(202).json({ recibido: false, code: 'PAGO_NO_CORRELACIONADO' });
      return;
    }
    const result = await supabaseAdmin.rpc('confirm_student_payment', {
      p_id: paymentId,
      p_proveedor: 'kushki',
      p_referencia: event.reference,
      p_resultado: event.result,
      p_total: event.total,
      p_moneda: event.currency,
      p_event: event.event,
      p_hash: event.hash,
    });
    if (result.error) throwStudentPaymentError(result.error);
    if (result.data.estado === 'aprobado') await paymentWelcome.deliver(result.data.id);
    res.json({ recibido: true });
  }),
);
