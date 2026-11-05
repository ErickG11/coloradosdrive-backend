import { createHmac } from 'node:crypto';
import { Router } from 'express';
import { body, matchedData, param, type ValidationChain } from 'express-validator';
import type { Request } from 'express';
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
function planValidators(selection: boolean): ValidationChain[] {
  return [
    body()
      .custom((value: unknown) =>
        onlyKeys(value, selection ? [...planFields, 'franjas'] : planFields),
      )
      .withMessage('La solicitud contiene campos no permitidos.'),
    body('enrollmentId').isUUID().withMessage('Selecciona una matrícula válida.'),
    body('modalidad')
      .isIn(['entre_semana', 'fin_de_semana'])
      .withMessage('Selecciona la modalidad.'),
    body('fechaInicio')
      .isString()
      .bail()
      .matches(/^\d{4}-\d{2}-\d{2}$/)
      .bail()
      .isDate({ format: 'YYYY-MM-DD', strictMode: true })
      .withMessage('Selecciona una fecha válida.'),
    body('horasPorDia')
      .custom(
        (value: unknown) =>
          typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6,
      )
      .withMessage('Selecciona entre 1 y 6 horas por día.'),
    ...(selection
      ? [
          body('franjas')
            .isArray({ min: 1, max: 500 })
            .withMessage('Selecciona las franjas del plan.'),
          body('franjas.*')
            .custom((value: unknown) => onlyKeys(value, ['fecha', 'hora']))
            .withMessage('La franja contiene campos no permitidos.'),
          body('franjas.*.fecha')
            .isString()
            .bail()
            .matches(/^\d{4}-\d{2}-\d{2}$/)
            .withMessage('La fecha de una franja no es válida.'),
          body('franjas.*.hora')
            .isString()
            .bail()
            .matches(/^(0[6-9]|1\d|2[01]):00$/)
            .withMessage('Selecciona horas entre 06:00 y 21:00.'),
        ]
      : []),
  ];
}
studentScheduleRouter.use((req, _res, next) => {
  if (Object.keys(req.query).length) {
    next(new AppError('No se admiten parámetros en esta ruta.', 400, { code: 'INVALID_FIELD' }));
    return;
  }
  next();
});
studentScheduleRouter.post(
  '/disponibilidad',
  readLimit,
  planValidators(false),
  validateFields,
  asyncHandler(async (req, res) => {
    const input = matchedData<StudentScheduleInput & { enrollmentId: string }>(req, {
      locations: ['body'],
    });
    res.json(await service.availability(subject(req), input.enrollmentId, input));
  }),
);
studentScheduleRouter.post(
  '/reservas',
  reserveLimit,
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
