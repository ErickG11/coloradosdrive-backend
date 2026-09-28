import { Router } from 'express';
import { body, param } from 'express-validator';

import { createCohort, listCohorts, updateCohort } from '../controllers/cohort.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/asyncHandler';

export const cohortRouter = Router();

// RF-01: solo el administrador puede crear y editar matrículas/cohortes.
cohortRouter.use(asyncHandler(authenticate), requireRole('admin'));

const createValidators = [
  body('courseId').isUUID().withMessage('courseId debe ser un UUID válido'),
  body('nombre').isString().trim().notEmpty().withMessage('nombre es obligatorio'),
  body('precio').isFloat({ min: 0 }).withMessage('precio debe ser un número mayor o igual a 0'),
  body('cupoMaximo').isInt({ min: 1 }).withMessage('cupoMaximo debe ser un entero mayor a 0'),
  body('fechaInicioMatricula')
    .isISO8601()
    .withMessage('fechaInicioMatricula debe ser una fecha válida (ISO 8601)'),
  body('fechaFinMatricula')
    .isISO8601()
    .withMessage('fechaFinMatricula debe ser una fecha válida (ISO 8601)'),
  body('fechaInicioCurso')
    .isISO8601()
    .withMessage('fechaInicioCurso debe ser una fecha válida (ISO 8601)'),
  body('fechaFinCurso')
    .isISO8601()
    .withMessage('fechaFinCurso debe ser una fecha válida (ISO 8601)'),
  body('tipoModalidad').optional({ values: 'null' }).isString(),
  body('horariosCapacitacionTeoria').optional({ values: 'null' }).isString(),
  body('numeroVehiculos').optional({ values: 'null' }).isInt({ min: 0 }),
  body('numeroAulas').optional({ values: 'null' }).isInt({ min: 0 }),
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
  body('fechaInicioMatricula')
    .optional()
    .isISO8601()
    .withMessage('fechaInicioMatricula debe ser una fecha válida (ISO 8601)'),
  body('fechaFinMatricula')
    .optional()
    .isISO8601()
    .withMessage('fechaFinMatricula debe ser una fecha válida (ISO 8601)'),
  body('fechaInicioCurso')
    .optional()
    .isISO8601()
    .withMessage('fechaInicioCurso debe ser una fecha válida (ISO 8601)'),
  body('fechaFinCurso')
    .optional()
    .isISO8601()
    .withMessage('fechaFinCurso debe ser una fecha válida (ISO 8601)'),
  body('tipoModalidad').optional({ values: 'null' }).isString(),
  body('horariosCapacitacionTeoria').optional({ values: 'null' }).isString(),
  body('numeroVehiculos').optional({ values: 'null' }).isInt({ min: 0 }),
  body('numeroAulas').optional({ values: 'null' }).isInt({ min: 0 }),
];

cohortRouter.post('/', createValidators, validate, asyncHandler(createCohort));
cohortRouter.get('/', asyncHandler(listCohorts));
cohortRouter.patch('/:id', updateValidators, validate, asyncHandler(updateCohort));
