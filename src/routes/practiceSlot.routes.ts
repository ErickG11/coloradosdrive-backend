import { Router } from 'express';
import { body, param, query } from 'express-validator';

import {
  createPracticeSlot,
  deletePracticeSlot,
  listPracticeSlots,
  updatePracticeSlot,
} from '../controllers/practiceSlot.controller';
import {
  cancelPracticeSlot,
  claimPracticeSlot,
  confirmPracticeSlot,
  markPracticeSlotAttendance,
  previewPracticeSlotCancellation,
  releasedPracticeSlotsForMe,
  myPendingPracticeSlots,
  swapPracticeSlot,
} from '../controllers/practiceSlotAction.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validate, validateFields } from '../middlewares/validate';
import { attendanceEvents } from '../controllers/practiceAttendance.controller';
import { attendancePagination, attendanceReason, attendanceValue } from './practiceAttendance.validators';
import { CANCELLATION_CATEGORIES, PRACTICE_SLOT_STATUSES } from '../models/practiceSlot.model';
import { asyncHandler } from '../utils/asyncHandler';
import { normalizePracticeScheduledAt } from '../utils/practiceSlotTimestamp';

export const practiceSlotRouter = Router();

practiceSlotRouter.use(asyncHandler(authenticate));

const createValidators = [
  body('cohortId').isUUID().withMessage('cohortId debe ser un UUID válido'),
  body('instructorId').isUUID().withMessage('instructorId debe ser un UUID válido'),
  body('scheduledAt')
    .custom((value: unknown) => { normalizePracticeScheduledAt(value); return true; }),
  body('durationMinutes')
    .optional()
    .custom((value: unknown) => value === 60)
    .withMessage('Las prácticas deben durar exactamente 60 minutos'),
];

const idParamValidator = param('id').isUUID().withMessage('id debe ser un UUID válido');

const updateValidators = [
  idParamValidator,
  body('instructorId').optional().isUUID().withMessage('instructorId debe ser un UUID válido'),
  body('scheduledAt')
    .optional()
    .custom((value: unknown) => { normalizePracticeScheduledAt(value); return true; }),
  body('durationMinutes')
    .optional()
    .custom((value: unknown) => value === 60)
    .withMessage('Las prácticas deben durar exactamente 60 minutos'),
];

function isInstructorUser(user: unknown): boolean {
  return typeof user === 'object' && user !== null && 'role' in user
    && user.role === 'instructor';
}

const listValidators = [
  query('cohortId').optional().isUUID().withMessage('cohortId debe ser un UUID válido'),
  query('instructorId').optional().isUUID().withMessage('instructorId debe ser un UUID válido'),
  query('status')
    .optional()
    .isIn(PRACTICE_SLOT_STATUSES)
    .withMessage('status debe ser un estado válido'),
  query('from').if((_value, { req }) => isInstructorUser(req.user)).optional()
    .custom((value: unknown) => { normalizePracticeScheduledAt(value); return true; })
    .withMessage('from debe ser una fecha y hora ISO 8601 con zona explícita'),
  query('to').if((_value, { req }) => isInstructorUser(req.user)).optional()
    .custom((value: unknown) => { normalizePracticeScheduledAt(value); return true; })
    .withMessage('to debe ser una fecha y hora ISO 8601 con zona explícita'),
  query().custom((_value, { req }) => {
    if (!isInstructorUser(req.user)) return true;
    const { from, to } = req.query ?? {};
    if (from === undefined && to === undefined) return true;
    if (typeof from !== 'string' || typeof to !== 'string')
      throw new Error('from y to deben enviarse juntos');
    // Normalizar a UTC conserva los microsegundos de PostgreSQL.
    let normalizedFrom: string;
    let normalizedTo: string;
    try {
      normalizedFrom = normalizePracticeScheduledAt(from);
      normalizedTo = normalizePracticeScheduledAt(to);
    } catch {
      return true; // Los validadores de cada campo comunican el error.
    }
    const micros = (iso: string): bigint => {
      const match = /^(.+)\.(\d+)Z$/.exec(iso);
      if (!match) throw new Error('Formato de fecha inválido');
      const [, seconds, fraction] = match;
      return BigInt(Date.parse(`${seconds}Z`)) * 1000n + BigInt(fraction.padEnd(6, '0'));
    };
    const span = micros(normalizedTo) - micros(normalizedFrom);
    if (span <= 0n) throw new Error('from debe ser anterior a to');
    if (span > 62n * 24n * 60n * 60n * 1_000_000n)
      throw new Error('El rango no puede superar 62 días');
    return true;
  }),
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
practiceSlotRouter.get('/released-for-me', requireRole('estudiante'), asyncHandler(releasedPracticeSlotsForMe));
practiceSlotRouter.get('/my-pending', requireRole('estudiante'), asyncHandler(myPendingPracticeSlots));
practiceSlotRouter.post(
  '/:id/swap', requireRole('estudiante'),
  [idParamValidator, body('practicaASoltarId').optional().isString()
    .withMessage('practicaASoltarId debe ser un UUID válido').bail().isUUID()
    .withMessage('practicaASoltarId debe ser un UUID válido')],
  validate, asyncHandler(swapPracticeSlot),
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

// RF-03: solo el estudiante reclama/confirma/cancela, y solo sobre sus
// propias franjas (verificado en PracticeSlotActionService).
practiceSlotRouter.post(
  '/:id/claim',
  requireRole('estudiante'),
  idParamValidator,
  validate,
  asyncHandler(claimPracticeSlot),
);
practiceSlotRouter.post(
  '/:id/confirm',
  requireRole('estudiante'),
  idParamValidator,
  validate,
  asyncHandler(confirmPracticeSlot),
);
practiceSlotRouter.post(
  '/:id/cancel',
  requireRole('estudiante'),
  [idParamValidator,
    body('motivoCategoria').isString().bail().isIn(CANCELLATION_CATEGORIES)
      .withMessage('Indica una categoría de cancelación válida'),
    body('motivoTexto').isString().bail().trim().isLength({ min: 10 })
      .withMessage('El motivo debe tener al menos 10 caracteres'),
  ],
  validate,
  asyncHandler(cancelPracticeSlot),
);
practiceSlotRouter.get(
  '/:id/cancel-preview', requireRole('estudiante'), idParamValidator, validate,
  asyncHandler(previewPracticeSlotCancellation),
);

// RF-03 (alcance agregado en Sprint 4, ver docs/adr/007): el instructor
// marca asistencia solo sobre sus propias franjas ya completadas.
practiceSlotRouter.patch(
  '/:id/attendance',
  requireRole('instructor'),
  [idParamValidator, attendanceValue(), attendanceReason(false)],
  validateFields,
  asyncHandler(markPracticeSlotAttendance),
);
practiceSlotRouter.patch('/:id/attendance/correction', requireRole('admin'),
  [idParamValidator, attendanceValue(), attendanceReason(true)], validateFields,
  asyncHandler(markPracticeSlotAttendance));
practiceSlotRouter.get('/:id/attendance/events', requireRole('admin'),
  [idParamValidator, ...attendancePagination()], validateFields, asyncHandler(attendanceEvents));
