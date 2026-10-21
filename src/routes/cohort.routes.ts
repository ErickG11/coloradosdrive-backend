import { Router } from 'express';
import { body, param, type ValidationChain } from 'express-validator';

import {
  createCohort,
  getCohort,
  listCohorts,
  updateCohort,
} from '../controllers/cohort.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validateFields } from '../middlewares/validate';
import { asyncHandler } from '../utils/asyncHandler';
import {
  COHORT_DATE_FIELDS,
  COHORT_LIMITS as L,
  COHORT_MESSAGES as M,
  isFechaCivil,
  maxCohortDate,
} from '../utils/cohortRules';

export const cohortRouter = Router();

// RF-01: solo el administrador puede crear y editar matrículas/cohortes.
cohortRouter.use(asyncHandler(authenticate), requireRole('admin'));

type Mode = 'create' | 'update';

const VERSION_REGEX = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;

const idParam = (): ValidationChain => param('id').isUUID().withMessage(M.idInvalido);

// Los validadores estándar de express-validator recorren los arreglos
// elemento a elemento (y aceptan []): los números se exigen escalares.
const isNumberLike = (value: unknown): boolean =>
  typeof value === 'number' || typeof value === 'string';
const isPresent = (value: unknown): boolean =>
  value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '');

// En crear, el campo es obligatorio; en actualizar solo se valida si viene
// (null o '' cuentan como enviados y se rechazan).
function required(name: string, mode: Mode): ValidationChain {
  return mode === 'update' ? body(name).optional() : body(name);
}

function optionalNullable(name: string): ValidationChain {
  return body(name).optional({ values: 'null' });
}

// F-05: una sola definición para crear y actualizar; `mode` decide si los
// campos son obligatorios u opcionales. Un mensaje por campo (3.8).
export function cohortValidators(mode: Mode): ValidationChain[] {
  const dates = COHORT_DATE_FIELDS.map((field) =>
    required(field, mode)
      .custom(isFechaCivil)
      .withMessage(M[field])
      .bail()
      .custom((value: string) => value <= maxCohortDate())
      .withMessage(M.fechaLejana),
  );
  const resource = (name: string, message: string): ValidationChain =>
    optionalNullable(name)
      .custom(isNumberLike)
      .withMessage(message)
      .bail()
      .isInt({ min: 0, max: L.recursosMax })
      .withMessage(message)
      .bail()
      .toInt();
  const text = (name: string, max: number, message: string): ValidationChain =>
    optionalNullable(name)
      .isString()
      .withMessage(message)
      .bail()
      .isLength({ max })
      .withMessage(message);

  return [
    ...(mode === 'update'
      ? [
          idParam(),
          // 4.1: versión base obligatoria (el `updatedAt` exacto del GET).
          body('updatedAt')
            .isString()
            .withMessage(M.versionFaltante)
            .bail()
            .isISO8601({ strict: true })
            .withMessage(M.versionFaltante)
            .bail()
            // Marca de tiempo completa (fecha, hora y zona), como la devuelve
            // PostgREST: «2026», «2026-10» o «2026-W01» pasan isISO8601 pero
            // PostgreSQL los rechaza (22007) y darían 500.
            .matches(VERSION_REGEX)
            .withMessage(M.versionFaltante),
        ]
      : []),
    required('courseId', mode)
      .isString()
      .withMessage(M.cursoInvalido)
      .bail()
      .isUUID()
      .withMessage(M.cursoInvalido),
    required('nombre', mode)
      .isString()
      .withMessage(M.nombreObligatorio)
      .bail()
      .trim()
      .notEmpty()
      .withMessage(M.nombreObligatorio)
      .bail()
      .isLength({ max: L.nombreMax })
      .withMessage(M.nombreLargo),
    required('precio', mode)
      .custom(isPresent)
      .withMessage(M.precioObligatorio)
      .bail()
      .custom(isNumberLike)
      .withMessage(M.precioRango)
      .bail()
      .isFloat({ min: 0, max: L.precioMax })
      .withMessage(M.precioRango)
      .bail()
      .isDecimal({ decimal_digits: '0,2' })
      .withMessage(M.precioDecimales)
      .bail()
      .toFloat(),
    required('cupoMaximo', mode)
      .custom(isNumberLike)
      .withMessage(M.cupo)
      .bail()
      .isInt({ min: L.cupoMin, max: L.cupoMax })
      .withMessage(M.cupo)
      .bail()
      .toInt(),
    ...dates,
    text('tipoModalidad', L.tipoModalidadMax, M.tipoModalidad),
    text('horariosCapacitacionTeoria', L.horariosTeoriaMax, M.horariosTeoria),
    resource('numeroVehiculos', M.vehiculos),
    resource('numeroAulas', M.aulas),
  ];
}

cohortRouter.post('/', cohortValidators('create'), validateFields, asyncHandler(createCohort));
cohortRouter.get('/', asyncHandler(listCohorts));
cohortRouter.get('/:id', idParam(), validateFields, asyncHandler(getCohort));
cohortRouter.patch('/:id', cohortValidators('update'), validateFields, asyncHandler(updateCohort));
