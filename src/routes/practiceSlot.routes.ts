import { Router } from 'express';
import { body, param, query } from 'express-validator';

import {
  createPracticeSlot,
  deletePracticeSlot,
  listPracticeSlots,
  updatePracticeSlot,
} from '../controllers/practiceSlot.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate';
import { PRACTICE_SLOT_STATUSES } from '../models/practiceSlot.model';
import { asyncHandler } from '../utils/asyncHandler';

export const practiceSlotRouter = Router();

practiceSlotRouter.use(asyncHandler(authenticate));

const createValidators = [
  body('cohortId').isUUID().withMessage('cohortId debe ser un UUID válido'),
  body('instructorId').isUUID().withMessage('instructorId debe ser un UUID válido'),
  body('scheduledAt')
    .isISO8601()
    .withMessage('scheduledAt debe ser una fecha/hora válida (ISO 8601)'),
  body('durationMinutes')
    .isInt({ min: 1 })
    .withMessage('durationMinutes debe ser un entero mayor a 0'),
];

const idParamValidator = param('id').isUUID().withMessage('id debe ser un UUID válido');

const updateValidators = [
  idParamValidator,
  body('instructorId').optional().isUUID().withMessage('instructorId debe ser un UUID válido'),
  body('scheduledAt')
    .optional()
    .isISO8601()
    .withMessage('scheduledAt debe ser una fecha/hora válida (ISO 8601)'),
  body('durationMinutes')
    .optional()
    .isInt({ min: 1 })
    .withMessage('durationMinutes debe ser un entero mayor a 0'),
];

const listValidators = [
  query('cohortId').optional().isUUID().withMessage('cohortId debe ser un UUID válido'),
  query('instructorId').optional().isUUID().withMessage('instructorId debe ser un UUID válido'),
  query('status')
    .optional()
    .isIn(PRACTICE_SLOT_STATUSES)
    .withMessage('status debe ser un estado válido'),
];

// RF-03: el admin gestiona franjas (crear/editar/eliminar); estudiante e
// instructor solo listan aquí - sus propias acciones (reclamar/
// confirmar/cancelar/marcar asistencia) viven en rutas separadas
// (próximos commits).
practiceSlotRouter.post(
  '/',
  requireRole('admin'),
  createValidators,
  validate,
  asyncHandler(createPracticeSlot),
);
practiceSlotRouter.get(
  '/',
  requireRole('admin', 'estudiante', 'instructor'),
  listValidators,
  validate,
  asyncHandler(listPracticeSlots),
);
practiceSlotRouter.patch(
  '/:id',
  requireRole('admin'),
  updateValidators,
  validate,
  asyncHandler(updatePracticeSlot),
);
practiceSlotRouter.delete(
  '/:id',
  requireRole('admin'),
  idParamValidator,
  validate,
  asyncHandler(deletePracticeSlot),
);
