import { Router } from 'express';
import {
  instructorRatingDetail,
  listInstructorRatings,
} from '../controllers/practiceRating.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validateFields } from '../middlewares/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { ratingInstructorId, ratingPagination } from './practiceRating.validators';

export const instructorRatingRouter = Router();
instructorRatingRouter.use(asyncHandler(authenticate), requireRole('admin'));
instructorRatingRouter.get(
  '/',
  ratingPagination(),
  validateFields,
  asyncHandler(listInstructorRatings),
);
instructorRatingRouter.get(
  '/:instructorId',
  [ratingInstructorId, ...ratingPagination()],
  validateFields,
  asyncHandler(instructorRatingDetail),
);
