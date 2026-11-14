import type { RequestHandler } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { cohortError, translateCohortSqlError } from '../config/cohortErrors';
import { asyncHandler } from '../utils/asyncHandler';
export type EnrollmentPermission =
  'verify_identity' | 'manage_cohorts_prices' | 'reassign_schedules' | 'view_payments_invoices';
export const requireEnrollmentPermission = (permission: EnrollmentPermission): RequestHandler =>
  asyncHandler(async (req, _res, next) => {
    if (!req.user) throw cohortError('PERMISO_REQUERIDO');
    const r = await supabaseAdmin.rpc('assert_enrollment_permission_v2', {
      p_actor: req.user.id,
      p_permission: permission,
    });
    if (r.error) throw translateCohortSqlError(r.error) ?? cohortError('PERMISO_REQUERIDO');
    next();
  });
