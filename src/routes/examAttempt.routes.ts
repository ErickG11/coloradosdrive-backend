import { Router } from 'express';
import { body, param } from 'express-validator';

import { submitAttempt } from '../controllers/examAttempt.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/asyncHandler';

export const attemptRouter = Router();

attemptRouter.use(asyncHandler(authenticate));

// Cada respuesta trae exactamente uno de selectedOptionId/textAnswer; una
// pregunta que no aparece en el arreglo se califica como no respondida
// (incorrecta), no rechaza la petición.
function validateAnswerShape(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    throw new Error('cada respuesta debe ser un objeto');
  }
  const answer = value as Record<string, unknown>;

  if (typeof answer.questionId !== 'string') {
    throw new Error('questionId es obligatorio en cada respuesta');
  }

  const hasOption = answer.selectedOptionId !== undefined;
  const hasText = answer.textAnswer !== undefined;
  if (hasOption === hasText) {
    throw new Error('cada respuesta debe traer exactamente uno de selectedOptionId o textAnswer');
  }
  if (hasOption && typeof answer.selectedOptionId !== 'string') {
    throw new Error('selectedOptionId debe ser un string');
  }
  if (hasText && (typeof answer.textAnswer !== 'string' || answer.textAnswer.trim() === '')) {
    throw new Error('textAnswer no puede estar vacío');
  }

  return true;
}

const submitValidators = [
  param('id').isUUID().withMessage('id debe ser un UUID válido'),
  body('answers').isArray().withMessage('answers debe ser un arreglo'),
  body('answers.*').custom(validateAnswerShape),
];

attemptRouter.post(
  '/:id/submit',
  requireRole('estudiante'),
  submitValidators,
  validate,
  asyncHandler(submitAttempt),
);
