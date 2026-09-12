import { Router } from 'express';
import { query } from 'express-validator';

import { listUsers } from '../controllers/user.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate';
import { ROLES } from '../models/user.model';
import { asyncHandler } from '../utils/asyncHandler';

export const userRouter = Router();

// admin-only otra vez (ver docs/adr/008): la ampliación de rol=instructor
// a cualquier autenticado (PR #11) se revierte porque los listados de
// practice_slots ahora embeben instructorName/studentName directamente -
// ya nadie fuera de admin necesita listar usuarios por rol.
userRouter.use(asyncHandler(authenticate), requireRole('admin'));

userRouter.get(
  '/',
  [
    query('rol')
      .isIn(ROLES)
      .withMessage('rol debe ser uno de: ' + ROLES.join(', ')),
  ],
  validate,
  asyncHandler(listUsers),
);
