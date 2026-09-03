import { Router } from 'express';
import { body } from 'express-validator';

import { createEnrollment } from '../controllers/enrollment.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/asyncHandler';

export const enrollmentRouter = Router();

// RF-01: solo el administrador puede crear matrículas.
enrollmentRouter.use(asyncHandler(authenticate), requireRole('admin'));

const enrollValidators = [
  body('cedula')
    .matches(/^[0-9]{10}$/)
    .withMessage('cedula debe tener 10 dígitos numéricos'),
  body('nombreCompleto').isString().trim().notEmpty().withMessage('nombreCompleto es obligatorio'),
  body('correo').isEmail().withMessage('correo debe ser un correo electrónico válido'),
  body('telefono')
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage('telefono no puede estar vacío si se envía'),
  body('cohortId').isUUID().withMessage('cohortId debe ser un UUID válido'),
];

enrollmentRouter.post('/', enrollValidators, validate, asyncHandler(createEnrollment));
