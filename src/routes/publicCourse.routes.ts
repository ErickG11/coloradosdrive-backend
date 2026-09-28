import { Router } from 'express';

import { listPublicCourses } from '../controllers/publicCourse.controller';
import { publicReadRateLimiter } from '../middlewares/rateLimit';
import { asyncHandler } from '../utils/asyncHandler';

// Sin authenticate ni requireRole a propósito: es la landing pública.
// GET /courses (admin) sigue intacto en course.routes.ts — esta es una
// ruta separada, no una relajación de esa.
export const publicCourseRouter = Router();

publicCourseRouter.get('/', publicReadRateLimiter, asyncHandler(listPublicCourses));
