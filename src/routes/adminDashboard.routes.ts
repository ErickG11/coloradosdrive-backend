import { Router } from 'express';
import { query } from 'express-validator';
import { supabaseAdmin } from '../config/supabase';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate';
import { AdminDashboardService } from '../services/adminDashboard.service';
import { asyncHandler } from '../utils/asyncHandler';

export const adminDashboardRouter = Router();
const service = new AdminDashboardService(supabaseAdmin);
adminDashboardRouter.use(asyncHandler(authenticate), requireRole('admin'));
adminDashboardRouter.get(
  '/',
  [
    query().custom((value: Record<string, unknown>) =>
      Object.keys(value).every((key) => ['month', 'day'].includes(key)),
    ),
    query('month')
      .optional()
      .isString()
      .matches(/^\d{4}-\d{2}$/),
    query('day')
      .optional()
      .isString()
      .matches(/^\d{4}-\d{2}-\d{2}$/),
  ],
  validate,
  asyncHandler(async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(
      await service.summary(
        req.query.month as string | undefined,
        req.query.day as string | undefined,
      ),
    );
  }),
);
