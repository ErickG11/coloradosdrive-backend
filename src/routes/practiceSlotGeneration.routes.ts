import { Router } from 'express';
import { body, param } from 'express-validator';
import type { Meta, ValidationChain } from 'express-validator';

import {
  confirmarPractica,
  sugerirPractica,
} from '../controllers/practiceSlotGeneration.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate';
import { MODALIDADES } from '../models/practiceSlotGeneration.model';
import { asyncHandler } from '../utils/asyncHandler';

// Generador en bloque de franjas de práctica para una matrícula, en dos
// pasos (sugerir/confirmar) — ver docs/adr/007 para el resto de decisiones
// de practice_slots, que este módulo reutiliza tal cual.
export const practiceSlotGenerationRouter = Router();

practiceSlotGenerationRouter.use(asyncHandler(authenticate), requireRole('admin'));

const enrollmentIdValidator = param('enrollmentId')
  .isUUID()
  .withMessage('enrollmentId debe ser un UUID válido');

const horaValidator = (field: string): ValidationChain =>
  body(field)
    .matches(/^([01]\d|2[0-3]):[0-5]\d$/)
    .withMessage(`${field} debe tener formato HH:mm`);

const fechaValidator = (field: string, optional = false): ValidationChain => {
  const chain = body(field)
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage(`${field} debe tener formato YYYY-MM-DD`);
  return optional ? chain.optional() : chain;
};

// Exactamente uno de fechaFin/numeroSesiones - el resto de la validación de
// consistencia (fechaFin >= fechaInicio, rango no vacío) vive en el
// servicio, que es quien conoce la modalidad para calcularlo.
function exactlyOneOfFechaFinOrNumeroSesiones(_: unknown, { req }: Meta): boolean {
  const { fechaFin, numeroSesiones } = req.body as { fechaFin?: unknown; numeroSesiones?: unknown };
  if ((fechaFin === undefined) === (numeroSesiones === undefined)) {
    throw new Error('Debes indicar exactamente uno de fechaFin o numeroSesiones');
  }
  return true;
}

const baseValidators = [
  body('durationMinutes')
    .optional()
    .custom((value: unknown) => value === 60)
    .withMessage('Las prácticas deben durar exactamente 60 minutos'),
  fechaValidator('fechaInicio'),
  fechaValidator('fechaFin', true),
  body('numeroSesiones')
    .optional()
    .isInt({ min: 1 })
    .withMessage('numeroSesiones debe ser un entero mayor o igual a 1'),
  body('modalidad')
    .isIn(MODALIDADES)
    .withMessage('modalidad debe ser uno de: ' + MODALIDADES.join(', ')),
  body('horasPorDia')
    .isInt({ min: 1, max: 16 })
    .withMessage('horasPorDia debe ser un entero entre 1 y 16'),
  body().custom(exactlyOneOfFechaFinOrNumeroSesiones),
];

practiceSlotGenerationRouter.post(
  '/:enrollmentId/sugerir-practica',
  [enrollmentIdValidator, ...baseValidators, horaValidator('horaDeseada')],
  validate,
  asyncHandler(sugerirPractica),
);

practiceSlotGenerationRouter.post(
  '/:enrollmentId/confirmar-practica',
  [
    enrollmentIdValidator,
    ...baseValidators,
    horaValidator('horaResuelta'),
    body('instructorId').isUUID().withMessage('instructorId debe ser un UUID válido'),
  ],
  validate,
  asyncHandler(confirmarPractica),
);
