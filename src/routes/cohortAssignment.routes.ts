import { Router } from 'express';
import { body } from 'express-validator';

import { previewCohortAssignment } from '../controllers/cohortAssignment.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/asyncHandler';

// Fase 10: admin-only, igual que /enrollments.
export const cohortAssignmentRouter = Router();

cohortAssignmentRouter.use(asyncHandler(authenticate), requireRole('admin'));

cohortAssignmentRouter.post(
  '/preview',
  [body('courseId').isUUID().withMessage('courseId debe ser un UUID válido')],
  validate,
  asyncHandler(previewCohortAssignment),
);
