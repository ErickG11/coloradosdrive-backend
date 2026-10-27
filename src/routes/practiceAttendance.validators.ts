import { body, query, type ValidationChain } from 'express-validator';
export const attendanceValue = (): ValidationChain =>
  body('attended')
    .custom((value: unknown) => typeof value === 'boolean')
    .withMessage('Indica si el alumno asistió');
export const attendanceReason = (required: boolean): ValidationChain => {
  const validator = body('motivo');
  return (required ? validator : validator.optional())
    .isString()
    .withMessage('Indica un motivo válido')
    .bail()
    .trim()
    .isLength({ min: 10, max: 500 })
    .withMessage('El motivo debe tener entre 10 y 500 caracteres');
};
export const attendancePagination = (): ValidationChain[] => [
  query('page')
    .optional()
    .custom((v: unknown) => typeof v === 'string')
    .withMessage('page debe ser un único número')
    .bail()
    .isInt({ min: 1, max: 1000000 })
    .withMessage('page debe estar entre 1 y 1000000'),
  query('pageSize')
    .optional()
    .custom((v: unknown) => typeof v === 'string')
    .withMessage('pageSize debe ser un único número')
    .bail()
    .isInt({ min: 1, max: 100 })
    .withMessage('pageSize debe estar entre 1 y 100'),
];
