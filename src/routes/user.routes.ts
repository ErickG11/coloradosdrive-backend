import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { query } from 'express-validator';

import { listUsers } from '../controllers/user.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate';
import { ROLES } from '../models/user.model';
import { asyncHandler } from '../utils/asyncHandler';

export const userRouter = Router();

userRouter.use(asyncHandler(authenticate));

// rol=instructor es accesible para cualquier usuario autenticado (RF-03:
// el estudiante necesita ver el instructor de sus franjas de práctica; la
// lista de instructores no es información sensible). rol=estudiante y
// rol=admin siguen siendo admin-only.
function requireAdminUnlessListingInstructors(req: Request, res: Response, next: NextFunction): void {
  if (req.query.rol === 'instructor') {
    next();
    return;
  }
  requireRole('admin')(req, res, next);
}

userRouter.get(
  '/',
  [query('rol').isIn(ROLES).withMessage('rol debe ser uno de: ' + ROLES.join(', '))],
  validate,
  requireAdminUnlessListingInstructors,
  asyncHandler(listUsers),
);
