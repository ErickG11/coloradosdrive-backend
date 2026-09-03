import { Router } from 'express';

import { listCourses } from '../controllers/course.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { asyncHandler } from '../utils/asyncHandler';

export const courseRouter = Router();

courseRouter.use(asyncHandler(authenticate), requireRole('admin'));

courseRouter.get('/', asyncHandler(listCourses));
