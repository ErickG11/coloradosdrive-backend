import { Router } from 'express';
import type { RequestHandler } from 'express';
import { body, param, matchedData } from 'express-validator';
import type { ValidationChain } from 'express-validator';
import { supabaseAdmin } from '../config/supabase';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validateFields } from '../middlewares/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { throwStudentScheduleError } from '../utils/studentScheduleError';
import { enrollmentRuleEnabled } from '../services/enrollmentRuleFlags.service';
import { buildRateLimiter } from '../middlewares/rateLimit';
import { env } from '../config/env';
import { createHmac } from 'node:crypto';
import type { Json } from '../config/database.types';
const limit = (): RequestHandler =>
  buildRateLimiter(60, env.NODE_ENV === 'test', (req) =>
    createHmac('sha256', env.ENROLLMENT_RATE_HMAC_SECRET)
      .update(`billing:${req.user!.id}`)
      .digest('hex'),
  );
export const studentBillingRouter = Router(),
  adminBillingRouter = Router();
studentBillingRouter.use(limit());
adminBillingRouter.use(asyncHandler(authenticate), requireRole('admin'), limit());
const profile = (): ValidationChain[] => [
  body('profile').isObject(),
  ...['name', 'documentType', 'documentNumber', 'address', 'email'].map((k) =>
    body(`profile.${k}`)
      .isString()
      .isLength({ min: 1, max: k === 'address' ? 300 : 254 }),
  ),
  body('profile.email').isEmail(),
  body('profile.documentType').isIn(['ruc', 'cedula', 'pasaporte', 'otro']),
];
studentBillingRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    if (!(await enrollmentRuleEnabled(supabaseAdmin, 'billing'))) {
      res.json({ active: false });
      return;
    }
    const result = await supabaseAdmin.rpc('billing_state_v2', { p_student: req.user!.id });
    if (result.error) throwStudentScheduleError(result.error);
    res.json(result.data);
  }),
);
studentBillingRouter.patch(
  '/',
  profile(),
  validateFields,
  asyncHandler(async (req, res) => {
    const result = await supabaseAdmin.rpc('save_billing_profile_v2', {
      p_student: req.user!.id,
      p_profile: req.body.profile as Json,
    });
    if (result.error) throwStudentScheduleError(result.error);
    res.json(result.data);
  }),
);
adminBillingRouter.get(
  '/alumnos/:id',
  param('id').isUUID(),
  validateFields,
  asyncHandler(async (req, res) => {
    if (!(await enrollmentRuleEnabled(supabaseAdmin, 'billing'))) {
      res.json({ active: false });
      return;
    }
    const result = await supabaseAdmin.rpc('billing_state_v2', {
      p_student: req.params.id,
      p_actor: req.user!.id,
    });
    if (result.error) throwStudentScheduleError(result.error);
    res.json(result.data);
  }),
);
adminBillingRouter.patch(
  '/alumnos/:id',
  param('id').isUUID(),
  profile(),
  validateFields,
  asyncHandler(async (req, res) => {
    const result = await supabaseAdmin.rpc('save_billing_profile_v2', {
      p_student: req.params.id,
      p_profile: req.body.profile as Json,
      p_actor: req.user!.id,
    });
    if (result.error) throwStudentScheduleError(result.error);
    res.json(result.data);
  }),
);
adminBillingRouter.post(
  '/documentos/:id',
  param('id').isUUID(),
  body('updatedAt').isISO8601({ strict: true }),
  body('action').isIn(['retry', 'record_authorization']),
  body('data').isObject(),
  validateFields,
  asyncHandler(async (req, res) => {
    const data = matchedData<{ id: string; updatedAt: string; action: string; data: Json }>(req);
    const result = await supabaseAdmin.rpc('admin_billing_action_v2', {
      p_actor: req.user!.id,
      p_document: data.id,
      p_version: data.updatedAt,
      p_action: data.action,
      p_data: data.data,
    });
    if (result.error) throwStudentScheduleError(result.error);
    res.json(result.data);
  }),
);
adminBillingRouter.post(
  '/devoluciones',
  body('paymentId').isUUID(),
  body('key').isUUID(),
  body('amountCentavos').isInt({ min: 1 }).toInt(),
  body('reason').isString().trim().isLength({ min: 1, max: 500 }),
  body('reference').isString().trim().isLength({ min: 1, max: 160 }),
  validateFields,
  asyncHandler(async (req, res) => {
    const d = matchedData<{
      paymentId: string;
      key: string;
      amountCentavos: number;
      reason: string;
      reference: string;
    }>(req);
    const result = await supabaseAdmin.rpc('document_refund_v2', {
      p_actor: req.user!.id,
      p_payment: d.paymentId,
      p_key: d.key,
      p_amount: d.amountCentavos,
      p_reason: d.reason,
      p_reference: d.reference,
    });
    if (result.error) throwStudentScheduleError(result.error);
    res.json(result.data);
  }),
);
