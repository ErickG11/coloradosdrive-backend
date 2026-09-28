import { Router } from 'express';
import { body } from 'express-validator';

import { changePassword } from '../controllers/estudiante.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/asyncHandler';

export const estudianteRouter = Router();

estudianteRouter.use(asyncHandler(authenticate), requireRole('estudiante'));

// Única ruta exenta del bloqueo de auth.middleware.ts cuando
// debe_cambiar_password=true (ver CHANGE_PASSWORD_PATH en ese archivo).
estudianteRouter.post(
  '/cambiar-password',
  [
    body('nuevaPassword')
      .isString()
      .isLength({ min: 8 })
      .withMessage('nuevaPassword debe tener al menos 8 caracteres'),
  ],
  validate,
  asyncHandler(changePassword),
);
