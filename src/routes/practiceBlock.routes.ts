import { Router } from 'express';
import { body, param, query } from 'express-validator';
import {
  blockOptions,
  blockPreview,
  blockResolutionPreview,
  resolveBlock,
  blockSummary,
  cancelBlock,
  confirmBlock,
  takeBlock,
  practiceAbsences,
  instructorBlocks,
} from '../controllers/practiceBlock.controller';
import { requireRole } from '../middlewares/rbac.middleware';
import { requireRequisitosVerificados } from '../middlewares/requireRequisitosVerificados';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { CANCELLATION_CATEGORIES } from '../models/practiceSlot.model';
export const practiceBlockRouter = Router();
practiceBlockRouter.get(
  '/admin-absences',
  requireRole('admin'),
  query('studentId').optional().isUUID(),
  validate,
  asyncHandler(practiceAbsences),
);
practiceBlockRouter.get(
  '/instructor-groups',
  requireRole('instructor'),
  query('from')
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .isISO8601({ strict: true }),
  query('to')
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .isISO8601({ strict: true }),
  validate,
  asyncHandler(instructorBlocks),
);
practiceBlockRouter.use(requireRole('estudiante'));
const enrollment = () => param('enrollmentId').isUUID().withMessage('La matrícula no es válida');
const date = () =>
  param('date')
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .isISO8601({ strict: true })
    .withMessage('La fecha del bloque no es válida');
practiceBlockRouter.get('/summary', asyncHandler(blockSummary));
practiceBlockRouter.get('/options', asyncHandler(blockOptions));
practiceBlockRouter.get(
  '/:enrollmentId/:date/cancel-preview',
  enrollment(),
  date(),
  validate,
  asyncHandler(blockPreview),
);
practiceBlockRouter.get(
  '/:enrollmentId/:date/resolution-preview',
  enrollment(),
  date(),
  validate,
  asyncHandler(blockResolutionPreview),
);
practiceBlockRouter.post(
  '/:enrollmentId/:date/resolve',
  requireRequisitosVerificados,
  enrollment(),
  date(),
  body('accion').isIn(['mover', 'falta']).withMessage('Elige cambiar de hora o avisar la falta'),
  body('inicio')
    .if(body('accion').equals('mover'))
    .isISO8601({ strict: true })
    .withMessage('Elige una hora válida para el cambio'),
  body('motivoCategoria').isIn(CANCELLATION_CATEGORIES).withMessage('Selecciona un motivo válido'),
  body('motivoTexto')
    .isString()
    .bail()
    .trim()
    .isLength({ min: 10 })
    .withMessage('Escribe un motivo de al menos 10 caracteres'),
  validate,
  asyncHandler(resolveBlock),
);
practiceBlockRouter.post(
  '/:enrollmentId/:date/cancel',
  requireRequisitosVerificados,
  enrollment(),
  date(),
  body('motivoCategoria').isIn(CANCELLATION_CATEGORIES).withMessage('Selecciona un motivo válido'),
  body('motivoTexto')
    .isString()
    .bail()
    .trim()
    .isLength({ min: 10 })
    .withMessage('Escribe un motivo de al menos 10 caracteres'),
  validate,
  asyncHandler(cancelBlock),
);
practiceBlockRouter.post(
  '/:enrollmentId/:date/confirm',
  requireRequisitosVerificados,
  enrollment(),
  date(),
  validate,
  asyncHandler(confirmBlock),
);
practiceBlockRouter.post(
  '/:enrollmentId/take',
  requireRequisitosVerificados,
  enrollment(),
  body('optionId')
    .isString()
    .matches(/^[a-f0-9]{32}$/)
    .withMessage('El cupo no es válido'),
  validate,
  asyncHandler(takeBlock),
);
