import { body, param, type ValidationChain } from 'express-validator';
import { attendancePagination } from './practiceAttendance.validators';

export const ratingPagination = attendancePagination;

export const ratingSubmissionValidators: ValidationChain[] = [
  body('practiceSlotId').isUUID().withMessage('practiceSlotId debe ser un UUID válido'),
  body('score')
    .custom(
      (value: unknown) =>
        typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5,
    )
    .withMessage('score debe ser un entero entre 1 y 5'),
  body('comment')
    .optional()
    .isString()
    .withMessage('comment debe ser un texto')
    .bail()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('comment admite máximo 1000 caracteres'),
];

export const ratingInstructorId = param('instructorId')
  .isUUID()
  .withMessage('instructorId debe ser un UUID válido');
