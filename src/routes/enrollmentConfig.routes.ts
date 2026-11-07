import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { EnrollmentLimitsService } from '../services/enrollmentLimits.service';
import { asyncHandler } from '../utils/asyncHandler';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { publicReadRateLimiter } from '../middlewares/rateLimit';
import { AppError } from '../utils/AppError';

const service = new EnrollmentLimitsService(supabaseAdmin);
export const publicEnrollmentConfigRouter = Router();
publicEnrollmentConfigRouter.get(
  '/config',
  publicReadRateLimiter,
  asyncHandler(async (_req, res) => {
    res.set('Cache-Control', 'no-store').json(await service.publicConfig());
  }),
);
export const adminEnrollmentConfigRouter = Router();
adminEnrollmentConfigRouter.use(asyncHandler(authenticate), requireRole('admin'));
adminEnrollmentConfigRouter.get(
  '/config',
  asyncHandler(async (_req, res) => {
    res.set('Cache-Control', 'no-store').json(await service.settings());
  }),
);
adminEnrollmentConfigRouter.put(
  '/config',
  asyncHandler(async (req, res) => {
    if (!req.user) throw new AppError('Inicia sesión.', 401);
    res.set('Cache-Control', 'no-store').json(await service.updateSettings(req.user.id, req.body));
  }),
);
