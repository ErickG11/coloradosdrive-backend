import { requireEnrollmentPermission } from '../middlewares/enrollmentPermission.middleware';
import { presentChangeReservation } from '../services/planChange.service';
import { translateCohortSqlError, cohortError as domainCohortError } from '../config/cohortErrors';
import { enrollmentRuleEnabled } from '../services/enrollmentRuleFlags.service';
import { supabaseAdmin } from '../config/supabase';
import { throwStudentScheduleError } from '../utils/studentScheduleError';
import { logDatabaseError } from '../utils/safeLog';
import { Router } from 'express';
import { body, param, type ValidationChain } from 'express-validator';

import {
  createCohort,
  deleteCohort,
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
cohortRouter.use((req, res, next) => {
  if (
    ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) &&
    !req.path.includes('reasign') &&
    !req.path.includes('cambio')
  )
    return requireEnrollmentPermission('manage_cohorts_prices')(req, res, next);
  next();
});
cohortRouter.get(
  '/configuracion',
  asyncHandler(async (req, res) => {
    const result = await supabaseAdmin.rpc('cohort_admin_config_v2', { p_actor: req.user!.id });
    if (result.error) throwStudentScheduleError(result.error);
    res.json(result.data);
  }),
);
cohortRouter.patch(
  '/configuracion/precio',
  body('tipo').isIn(['A', 'B']),
  body('centavos').isInt({ min: 0, max: 999999999 }).toInt(),
  body('motivo').isString().isLength({ min: 1, max: 500 }),
  validateFields,
  asyncHandler(async (req, res) => {
    const { tipo, centavos, motivo } = req.body as {
      tipo: 'A' | 'B';
      centavos: number;
      motivo: string;
    };
    const result = await supabaseAdmin.rpc('set_course_type_price_v2', {
      p_actor: req.user!.id,
      p_type: tipo,
      p_cents: centavos,
      p_reason: motivo,
    });
    if (result.error) throwStudentScheduleError(result.error);
    res.json({ updated: true });
  }),
);

cohortRouter.post(
  '/:id/espera/preview',
  param('id').isUUID(),
  validateFields,
  asyncHandler(async (req, res) => {
    if (!(await enrollmentRuleEnabled(supabaseAdmin, 'waitlist'))) {
      res.json({ count: 0 });
      return;
    }
    const result = await supabaseAdmin.rpc('preview_waitlist_event_v2', {
      p_actor: req.user!.id,
      p_cohort: req.params.id,
    });
    if (result.error) {
      logDatabaseError('waitlist_preview_failed', result.error);
      throw (
        translateCohortSqlError(result.error) ?? domainCohortError('ESPERA_PREVIEW_NO_DISPONIBLE')
      );
    }
    res.json(result.data);
  }),
);
cohortRouter.post(
  '/:id/espera/notificar',
  param('id').isUUID(),
  validateFields,
  asyncHandler(async (req, res) => {
    if (!(await enrollmentRuleEnabled(supabaseAdmin, 'waitlist')))
      throw domainCohortError('ESPERA_REGLAS_INACTIVAS');
    const result = await supabaseAdmin.rpc('enqueue_waitlist_event_v2', {
      p_actor: req.user!.id,
      p_cohort: req.params.id,
    });
    if (result.error) {
      logDatabaseError('waitlist_notify_failed', result.error);
      throw (
        translateCohortSqlError(result.error) ?? domainCohortError('ESPERA_NOTIFICAR_NO_DISPONIBLE')
      );
    }
    res.json({ queued: result.data });
  }),
);
cohortRouter.get(
  '/:id/reasignacion',
  param('id').isUUID(),
  validateFields,
  asyncHandler(async (req, res) => {
    if (!(await enrollmentRuleEnabled(supabaseAdmin, 'schedule_changes'))) {
      res.json({ active: false });
      return;
    }
    const result = await supabaseAdmin.rpc('cohort_reassignment_source_v2', {
      p_actor: req.user!.id,
      p_cohort: req.params.id,
    });
    if (result.error) throwStudentScheduleError(result.error);
    res.json(result.data);
  }),
);
for (const action of ['preview', 'aplicar'] as const)
  cohortRouter.post(
    `/:id/reasignacion/${action}`,
    param('id').isUUID(),
    body('changes').isArray({ min: 1, max: 100 }),
    body('changes.*.enrollmentId').isUUID(),
    body('changes.*.cohortId').isUUID(),
    body('changes.*.updatedAt').isISO8601({ strict: true }),
    body('changes.*.fechaInicio').matches(/^\d{4}-\d{2}-\d{2}$/),
    body('changes.*.modalidad').isIn(['entre_semana', 'fin_de_semana']),
    body('changes.*.horasPorDia').isInt({ min: 1, max: 6 }),
    body('changes.*.horaInicio').isInt({ min: 6, max: 23 }),
    body('motivo').isString().isLength({ min: 1, max: 500 }),
    validateFields,
    asyncHandler(async (req, res) => {
      const source = await supabaseAdmin.rpc('cohort_reassignment_source_v2', {
        p_actor: req.user!.id,
        p_cohort: req.params.id,
      });
      if (source.error) throwStudentScheduleError(source.error);
      const { changes, motivo } = req.body as {
        changes: Record<string, unknown>[];
        motivo: string;
      };
      if (!source.data.active) throw domainCohortError('PLAN_CAMBIO_REGLAS_INACTIVAS');
      if (changes.some((row) => !source.data.enrollments?.some((e) => e.id === row.enrollmentId)))
        throw domainCohortError('MATRICULA_AJENA');
      const result = await supabaseAdmin.rpc('bulk_reassign_enrollments_v2', {
        p_actor: req.user!.id,
        p_changes: changes,
        p_reason: motivo,
        p_preview: action === 'preview',
      });
      if (result.error) throwStudentScheduleError(result.error);
      res.json({
        ...result.data,
        plans: result.data.plans.map((p) => ({
          ...p,
          reservation: presentChangeReservation(p.reservation),
        })),
      });
    }),
  );
cohortRouter.post(
  '/:id/cancelar',
  param('id').isUUID(),
  body('updatedAt').isISO8601({ strict: true }),
  body('motivo').isString().isLength({ min: 1, max: 500 }),
  validateFields,
  asyncHandler(async (req, res) => {
    const { updatedAt, motivo } = req.body as { updatedAt: string; motivo: string };
    const result = await supabaseAdmin.rpc('cancel_cohort_v2', {
      p_actor: req.user!.id,
      p_cohort: req.params.id,
      p_version: updatedAt,
      p_reason: motivo,
    });
    if (result.error) throwStudentScheduleError(result.error);
    res.json(result.data);
  }),
);
type Mode = 'create' | 'update';

// Desfase horario como máximo ±15:59 (PostgreSQL rechaza más con 22009).
const VERSION_REGEX =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-](0\d|1[0-5])(:?[0-5]\d)?)$/;

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
    body('habilitada').optional().isBoolean(),
    body('reason').optional().isString().isLength({ min: 1, max: 500 }),
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
// L6b: solo admin (router) y confirmación escrita con el nombre exacto.
cohortRouter.delete(
  '/:id',
  idParam(),
  body('confirmacionNombre')
    .isString()
    .withMessage(M.confirmacionInvalida)
    .bail()
    .trim()
    .notEmpty()
    .withMessage(M.confirmacionInvalida),
  validateFields,
  asyncHandler(deleteCohort),
);
cohortRouter.patch('/:id', cohortValidators('update'), validateFields, asyncHandler(updateCohort));
