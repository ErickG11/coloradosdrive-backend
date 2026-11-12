import { buildRateLimiter } from '../middlewares/rateLimit';
import { env } from '../config/env';
import { createHmac } from 'node:crypto';
import { Router } from 'express';
import { body, param, matchedData } from 'express-validator';
import { supabaseAdmin } from '../config/supabase';
import { PlanChangeService } from '../services/planChange.service';
import type { StudentScheduleSelection } from '../models/studentSchedule.model';
import { validateFields } from '../middlewares/validate';
import { asyncHandler } from '../utils/asyncHandler';
const service = new PlanChangeService(supabaseAdmin);
export const planChangeRouter = Router();
planChangeRouter.use(
  buildRateLimiter(60, env.NODE_ENV === 'test', (req) =>
    createHmac('sha256', env.ENROLLMENT_RATE_HMAC_SECRET)
      .update(`plan-change:${req.user!.id}`)
      .digest('hex'),
  ),
);
const plan = () => [
  body().custom(
    (value: unknown) =>
      !!value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).every((k) =>
        ['modalidad', 'fechaInicio', 'horasPorDia', 'horaInicio'].includes(k),
      ),
  ),
  body('modalidad').isIn(['entre_semana', 'fin_de_semana']),
  body('fechaInicio').matches(/^\d{4}-\d{2}-\d{2}$/),
  body('horasPorDia').isInt({ min: 1, max: 6 }).toInt(),
  body('horaInicio').isInt({ min: 6, max: 21 }).toInt(),
];
planChangeRouter.get(
  '/:enrollmentId',
  param('enrollmentId').isUUID(),
  validateFields,
  asyncHandler(async (req, res) => {
    res
      .set('Cache-Control', 'no-store')
      .json(await service.state(req.user!.id, req.params.enrollmentId));
  }),
);
for (const action of ['preview', 'reservar', 'calendario'] as const)
  planChangeRouter.post(
    `/:enrollmentId/${action}`,
    param('enrollmentId').isUUID(),
    plan(),
    validateFields,
    asyncHandler(async (req, res) => {
      const input = matchedData<StudentScheduleSelection>(req, { locations: ['body'] });
      res.json(
        action === 'calendario'
          ? await service.calendar(req.user!.id, req.params.enrollmentId, input)
          : action === 'preview'
            ? await service.preview(req.user!.id, req.params.enrollmentId, input)
            : await service.reserve(req.user!.id, req.params.enrollmentId, input),
      );
    }),
  );
planChangeRouter.post(
  '/reserva/:id/confirmar',
  param('id').isUUID(),
  body().custom(
    (value: unknown) =>
      value === undefined ||
      (!!value && typeof value === 'object' && Object.keys(value).length === 0),
  ),
  validateFields,
  asyncHandler(async (req, res) => {
    res.json(await service.confirm(req.user!.id, req.params.id));
  }),
);
