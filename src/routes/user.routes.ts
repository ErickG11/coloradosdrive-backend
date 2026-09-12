import { Router } from 'express';
import { query } from 'express-validator';

import { listUsers } from '../controllers/user.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate';
import { ROLES } from '../models/user.model';
import { asyncHandler } from '../utils/asyncHandler';

export const userRouter = Router();

userRouter.use(asyncHandler(authenticate), requireRole('admin'));

userRouter.get(
  '/',
  [query('rol').isIn(ROLES).withMessage('rol debe ser uno de: ' + ROLES.join(', '))],
  validate,
  asyncHandler(listUsers),
);
