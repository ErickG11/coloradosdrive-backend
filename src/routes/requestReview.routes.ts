import { Router } from 'express';
import { param, body } from 'express-validator';
import { supabaseAdmin } from '../config/supabase';
import { RequestReviewService } from '../services/requestReview.service';
import { enrollmentRuleEnabled } from '../services/enrollmentRuleFlags.service';
import { asyncHandler } from '../utils/asyncHandler';
import { validateFields } from '../middlewares/validate';
import { uploadCertificado } from '../middlewares/uploadCertificado';
import { throwStudentScheduleError } from '../utils/studentScheduleError';
import { cohortError } from '../config/cohortErrors';
import type { Json } from '../config/database.types';
import { authenticatedUserId } from '../utils/requestUser';
export const requestReviewRouter = Router();
const service = new RequestReviewService(supabaseAdmin);
requestReviewRouter.get(
  '/politica-retencion',
  asyncHandler(async (req, res) => {
    if (!(await enrollmentRuleEnabled(supabaseAdmin, 'identity'))) {
      res.json({ active: false });
      return;
    }
    const permission = await supabaseAdmin.rpc('assert_identity_permission_v2', {
      p_actor: authenticatedUserId(req),
    });
    if (permission.error) throwStudentScheduleError(permission.error);
    const result = await supabaseAdmin.rpc('request_retention_config_v2');
    if (result.error) throwStudentScheduleError(result.error);
    res.json({ active: true, policy: result.data });
  }),
);
requestReviewRouter.patch(
  '/politica-retencion',
  body('policy').isObject(),
  body('reason').isString().trim().isLength({ min: 1, max: 500 }),
  validateFields,
  asyncHandler(async (req, res) => {
    const result = await supabaseAdmin.rpc('set_request_retention_v2', {
      p_actor: authenticatedUserId(req),
      p_policy: (req.body as { policy: Json }).policy,
      p_reason: (req.body as { reason: string }).reason,
    });
    if (result.error) throwStudentScheduleError(result.error);
    res.json(result.data);
  }),
);
requestReviewRouter.get(
  '/:id/revision',
  param('id').isUUID(),
  validateFields,
  asyncHandler(async (req, res) => {
    res.json(await service.state(authenticatedUserId(req), req.params.id));
  }),
);
requestReviewRouter.post(
  '/:id/revision/reclamar',
  param('id').isUUID(),
  validateFields,
  asyncHandler(async (req, res) => {
    res.json(await service.state(authenticatedUserId(req), req.params.id, true));
  }),
);
requestReviewRouter.post(
  '/:id/revision/verificar',
  param('id').isUUID(),
  validateFields,
  asyncHandler(async (req, _res, next) => {
    const state = await service.state(authenticatedUserId(req), req.params.id);
    if (!('owned' in state) || !state.owned) throw cohortError('SOLICITUD_REVISION_REQUERIDA');
    next();
  }),
  uploadCertificado,
  body('token').isUUID(),
  body('tipo').isIn(['identidad', 'estudios']),
  body('metodo').isString().isLength({ min: 1, max: 60 }),
  body('resultado').isIn(['verificado', 'no_coincide', 'no_encontrado']),
  body('mode').isIn(['web', 'presencial', 'documento_homologado']),
  body('nota').isString().trim().isLength({ min: 1, max: 1000 }),
  validateFields,
  asyncHandler(async (req, res) => {
    res.json(
      await service.verify(
        authenticatedUserId(req),
        req.params.id,
        req.body as Record<string, unknown>,
        req.file,
      ),
    );
  }),
);
requestReviewRouter.post(
  '/:id/revision/revocar',
  param('id').isUUID(),
  body('updatedAt').isISO8601({ strict: true }),
  body('reason').isString().trim().isLength({ min: 1, max: 500 }),
  validateFields,
  asyncHandler(async (req, res) => {
    const result = await supabaseAdmin.rpc('revoke_request_approval_v2', {
      p_actor: authenticatedUserId(req),
      p_id: req.params.id,
      p_version: (req.body as { updatedAt: string }).updatedAt,
      p_reason: (req.body as { reason: string }).reason,
    });
    if (result.error) throwStudentScheduleError(result.error);
    res.json(result.data);
  }),
);
requestReviewRouter.post(
  '/:id/revision/reintentar-correo',
  param('id').isUUID(),
  body('reason').isString().trim().isLength({ min: 1, max: 500 }),
  validateFields,
  asyncHandler(async (req, res) => {
    const result = await supabaseAdmin.rpc('retry_request_emails_v2', {
      p_actor: authenticatedUserId(req),
      p_id: req.params.id,
      p_reason: (req.body as { reason: string }).reason,
    });
    if (result.error) throwStudentScheduleError(result.error);
    res.json({ retried: result.data });
  }),
);
requestReviewRouter.get(
  '/:id/verificaciones/:verificationId/escaneo',
  param('id').isUUID(),
  param('verificationId').isUUID(),
  validateFields,
  asyncHandler(async (req, res) => {
    const permission = await supabaseAdmin.rpc('assert_identity_permission_v2', {
      p_actor: authenticatedUserId(req),
    });
    if (permission.error) throwStudentScheduleError(permission.error);
    const doc = await supabaseAdmin
      .from('solicitud_verificaciones')
      .select('scan_path,scan_deleted_at')
      .eq('solicitud_id', req.params.id)
      .eq('id', req.params.verificationId)
      .maybeSingle();
    if (doc.error) throwStudentScheduleError(doc.error);
    if (!doc.data?.scan_path || doc.data.scan_deleted_at)
      throw cohortError('SOLICITUD_ESCANEO_NO_DISPONIBLE');
    const audit = await supabaseAdmin.from('solicitud_auditoria').insert({
      solicitud_id: req.params.id,
      actor_id: authenticatedUserId(req),
      accion: 'abrir_escaneo_verificacion',
      documento_id: req.params.verificationId,
    });
    if (audit.error) throwStudentScheduleError(audit.error);
    const signed = await supabaseAdmin.storage
      .from('solicitudes-documentos')
      .createSignedUrl(doc.data.scan_path, 300, { download: true });
    if (signed.error) throw cohortError('SOLICITUD_ESCANEO_NO_DISPONIBLE');
    res.json({ url: signed.data.signedUrl, expiresIn: 300 });
  }),
);
