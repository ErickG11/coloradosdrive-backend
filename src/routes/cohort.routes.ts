import { Router } from 'express';
import { body, param } from 'express-validator';

import { createCohort, listCohorts, updateCohort } from '../controllers/cohort.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/asyncHandler';

export const cohortRouter = Router();

// RF-01: solo el administrador puede crear y editar matrículas/cohortes.
cohortRouter.use(authenticate, requireRole('admin'));

const createValidators = [
  body('courseId').isUUID().withMessage('courseId debe ser un UUID válido'),
  body('nombre').isString().trim().notEmpty().withMessage('nombre es obligatorio'),
  body('precio').isFloat({ min: 0 }).withMessage('precio debe ser un número mayor o igual a 0'),
  body('cupoMaximo').isInt({ min: 1 }).withMessage('cupoMaximo debe ser un entero mayor a 0'),
  body('fechaInicio').isISO8601().withMessage('fechaInicio debe ser una fecha válida (ISO 8601)'),
  body('fechaFin').isISO8601().withMessage('fechaFin debe ser una fecha válida (ISO 8601)'),
];

const updateValidators = [
  param('id').isUUID().withMessage('id debe ser un UUID válido'),
  body('courseId').optional().isUUID().withMessage('courseId debe ser un UUID válido'),
  body('nombre').optional().isString().trim().notEmpty().withMessage('nombre es obligatorio'),
  body('precio')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('precio debe ser un número mayor o igual a 0'),
  body('cupoMaximo')
    .optional()
    .isInt({ min: 1 })
    .withMessage('cupoMaximo debe ser un entero mayor a 0'),
  body('fechaInicio')
    .optional()
    .isISO8601()
    .withMessage('fechaInicio debe ser una fecha válida (ISO 8601)'),
  body('fechaFin')
    .optional()
    .isISO8601()
    .withMessage('fechaFin debe ser una fecha válida (ISO 8601)'),
];

cohortRouter.post('/', createValidators, validate, asyncHandler(createCohort));
cohortRouter.get('/', asyncHandler(listCohorts));
cohortRouter.patch('/:id', updateValidators, validate, asyncHandler(updateCohort));
