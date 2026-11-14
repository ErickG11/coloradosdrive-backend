import { throwStudentScheduleError } from '../utils/studentScheduleError';
import { enrollmentRuleEnabled } from '../services/enrollmentRuleFlags.service';
import { cohortError } from '../config/cohortErrors';
import { studentPlanRules } from '../services/studentPlanRules.service';
import { createHmac } from 'node:crypto';
import { Router } from 'express';
import { body, matchedData, param, type ValidationChain } from 'express-validator';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { supabaseAdmin } from '../config/supabase';
import { StudentScheduleService } from '../services/studentSchedule.service';
import type {
  StudentScheduleInput,
  StudentScheduleSelection,
} from '../models/studentSchedule.model';
import { validateFields } from '../middlewares/validate';
import { buildRateLimiter } from '../middlewares/rateLimit';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';

// Se monta DENTRO de estudianteRouter, después de authenticate + requireRole.
export const studentScheduleRouter = Router();
const service = new StudentScheduleService(supabaseAdmin, env);
function subject(req: Request): string {
  if (!req.user) throw new AppError('Inicia sesión nuevamente.', 401, { code: 'SESION_REQUERIDA' });
  return req.user.id;
}
function key(req: Request): string {
  return createHmac('sha256', env.ENROLLMENT_RATE_HMAC_SECRET)
    .update(`student-schedule:${subject(req)}`)
    .digest('hex');
}
// Límites por sujeto autenticado, independientes de la IP; diario/extension son SQL.
const readLimit = buildRateLimiter(180, env.NODE_ENV === 'test', key);
const reserveLimit = buildRateLimiter(12, env.NODE_ENV === 'test', key);
const changeLimit = buildRateLimiter(20, env.NODE_ENV === 'test', key);
function onlyKeys(value: unknown, allowed: string[]): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((k) => allowed.includes(k))
  );
}
const planFields = ['enrollmentId', 'modalidad', 'fechaInicio', 'horasPorDia'];
// La fecha y la hora de inicio se validan en el servicio para devolver sus códigos
// estables (FECHA_INICIO_INVALIDA, HORA_INICIO_INVALIDA); aquí solo el tipo.
function planValidators(withStartHour: boolean): ValidationChain[] {
  return [
    body()
      .custom((value: unknown) =>
        onlyKeys(value, withStartHour ? [...planFields, 'horaInicio'] : planFields),
      )
      .withMessage('La solicitud contiene campos no permitidos.'),
    body('enrollmentId').isUUID().withMessage('Selecciona una matrícula válida.'),
    body('modalidad')
      .isIn(['entre_semana', 'fin_de_semana'])
      .withMessage('Selecciona la modalidad.'),
    body('fechaInicio').isString().withMessage('Selecciona una fecha de inicio válida.'),
    body('horasPorDia')
      .custom(
        (value: unknown) =>
          typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6,
      )
      .withMessage('Selecciona entre 1 y 6 horas por día.'),
    ...(withStartHour
      ? [
          body('horaInicio')
            .custom((value: unknown) => typeof value === 'number')
            .withMessage('Selecciona la hora de inicio.'),
        ]
      : []),
  ];
}
// El cliente ya no propone franjas: el servidor calcula el plan fijo (I15).
function rejectSlotList(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === 'object' && 'franjas' in (req.body as object)) {
    next(
      new AppError('El horario se calcula en el servidor; envía solo la hora de inicio.', 400, {
        code: 'FRANJAS_NO_PERMITIDAS',
        field: 'franjas',
      }),
    );
    return;
  }
  next();
}
studentScheduleRouter.use((req, _res, next) => {
  if (Object.keys(req.query).length) {
    next(new AppError('No se admiten parámetros en esta ruta.', 400, { code: 'INVALID_FIELD' }));
    return;
  }
  next();
});
studentScheduleRouter.get(
  '/horario/config',
  readLimit,
  asyncHandler(async (req, res) => {
    subject(req);
    res.json(await studentPlanRules(supabaseAdmin));
  }),
);
studentScheduleRouter.post(
  '/horario/calendario',
  readLimit,
  planValidators(false),
  validateFields,
  asyncHandler(async (req, res) => {
    const input = matchedData<StudentScheduleInput & { enrollmentId: string }>(req, {
      locations: ['body'],
    });
    res.json(await service.calendar(subject(req), input.enrollmentId, input));
  }),
);
studentScheduleRouter.get(
  '/reserva/matricula/:enrollmentId',
  readLimit,
  param('enrollmentId').isUUID(),
  validateFields,
  asyncHandler(async (req, res) => {
    const { enrollmentId } = matchedData<{ enrollmentId: string }>(req, { locations: ['params'] });
    const reserva = await service.currentForEnrollment(subject(req), enrollmentId);
    res.json({ reserva, serverNow: reserva?.serverNow ?? new Date().toISOString() });
  }),
);
studentScheduleRouter.post(
  '/horario/opciones',
  readLimit,
  rejectSlotList,
  planValidators(false),
  validateFields,
  asyncHandler(async (req, res) => {
    const input = matchedData<StudentScheduleInput & { enrollmentId: string }>(req, {
      locations: ['body'],
    });
    res.json(await service.options(subject(req), input.enrollmentId, input));
  }),
);
studentScheduleRouter.post(
  '/horario/plan',
  readLimit,
  rejectSlotList,
  planValidators(true),
  validateFields,
  asyncHandler(async (req, res) => {
    const input = matchedData<StudentScheduleSelection & { enrollmentId: string }>(req, {
      locations: ['body'],
    });
    const preview = await service.preview(subject(req), input.enrollmentId, input);
    if (preview.factible) {
      const event = await supabaseAdmin.rpc('record_schedule_choice_v2', {
        p_student: subject(req),
        p_enrollment: input.enrollmentId,
      });
      if (event.error) throw event.error;
    }
    res.json(preview);
  }),
);
studentScheduleRouter.post(
  '/reservas',
  reserveLimit,
  rejectSlotList,
  planValidators(true),
  validateFields,
  asyncHandler(async (req, res) => {
    const input = matchedData<StudentScheduleSelection & { enrollmentId: string }>(req, {
      locations: ['body'],
    });
    res.status(201).json(await service.reserve(subject(req), input.enrollmentId, input));
  }),
);
studentScheduleRouter.get(
  '/reserva',
  readLimit,
  asyncHandler(async (req, res) => {
    const reserva = await service.manage(subject(req), 'actual');
    res.json({ reserva, serverNow: reserva?.serverNow ?? new Date().toISOString() });
  }),
);
for (const action of ['ampliar', 'liberar'] as const) {
  studentScheduleRouter.post(
    `/reservas/:id/${action}`,
    changeLimit,
    [
      param('id').isUUID().withMessage('Selecciona una reserva válida.'),
      body()
        .custom((value: unknown) => value === undefined || onlyKeys(value, []))
        .withMessage('Esta acción no admite campos.'),
    ],
    validateFields,
    asyncHandler(async (req, res) => {
      const { id } = matchedData<{ id: string }>(req, { locations: ['params'] });
      const reserva = await service.manage(subject(req), action, id);
      // Caducidad es resultado explícito: la RPC ya confirmó la limpieza en su transacción.
      res.json({ reserva, serverNow: reserva?.serverNow ?? new Date().toISOString() });
    }),
  );
}

studentScheduleRouter.get(
  '/espera',
  readLimit,
  asyncHandler(async (req, res) => {
    if (!(await enrollmentRuleEnabled(supabaseAdmin, 'waitlist'))) {
      res.json({ active: false, types: {} });
      return;
    }
    const result = await supabaseAdmin.rpc('get_enrollment_waitlist_v2', {
      p_student: subject(req),
    });
    if (result.error) throwStudentScheduleError(result.error);
    res.json(result.data);
  }),
);
studentScheduleRouter.post(
  '/espera',
  changeLimit,
  body('tipo').isIn(['A', 'B']),
  body('preferencia').not().exists(),
  body('quitar').optional().isBoolean(),
  validateFields,
  asyncHandler(async (req, res) => {
    if (!(await enrollmentRuleEnabled(supabaseAdmin, 'waitlist')))
      throw cohortError('ESPERA_REGLAS_INACTIVAS');
    const { tipo, preferencia, quitar } = req.body as {
      tipo: 'A' | 'B';
      preferencia?: Record<string, unknown> | null;
      quitar?: boolean;
    };
    const result = await supabaseAdmin.rpc('set_enrollment_waitlist_v2', {
      p_student: subject(req),
      p_type: tipo,
      p_preference: preferencia ?? null,
      p_remove: quitar ?? false,
    });
    if (result.error) throwStudentScheduleError(result.error);
    res.json(result.data);
  }),
);
