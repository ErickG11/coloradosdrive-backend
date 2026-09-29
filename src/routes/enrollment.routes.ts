import { Router } from 'express';
import { body } from 'express-validator';
import type { Meta } from 'express-validator';

import { createEnrollment } from '../controllers/enrollment.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/asyncHandler';

export const enrollmentRouter = Router();

// RF-01: solo el administrador puede crear matrículas.
enrollmentRouter.use(asyncHandler(authenticate), requireRole('admin'));

// Fase 10: cohortId es opcional (el admin puede sobreescribir la
// asignación automática), pero si no se manda, courseId es obligatorio
// para poder correr assignCohort contra las cohortes de ese curso — ver
// CreateEnrollmentInput y EnrollmentService.enrollStudent.
function requireCohortIdOrCourseId(_: unknown, { req }: Meta): boolean {
  const { cohortId, courseId } = req.body as { cohortId?: unknown; courseId?: unknown };
  if (cohortId === undefined && courseId === undefined) {
    throw new Error('Debes indicar cohortId o courseId');
  }
  return true;
}

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
  body('cohortId').optional().isUUID().withMessage('cohortId debe ser un UUID válido'),
  body('courseId').optional().isUUID().withMessage('courseId debe ser un UUID válido'),
  body().custom(requireCohortIdOrCourseId),
];

enrollmentRouter.post('/', enrollValidators, validate, asyncHandler(createEnrollment));
