import { Router, type Request, type Response } from 'express';
import { body, header, param, query } from 'express-validator';
import { mailer } from '../config/mailer';
import { supabaseAdmin } from '../config/supabase';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate';
import type { ManualEnrollmentInput, ManualPracticeInput } from '../models/manualEnrollment.model';
import { EmailService } from '../services/email.service';
import { ManualEnrollmentService } from '../services/manualEnrollment.service';
import { asyncHandler } from '../utils/asyncHandler';
import { manualPracticePlan } from '../utils/manualPracticePlan';
import { AppError } from '../utils/AppError';
function actor(req: Request): string {
  if (!req.user) throw new AppError('Authentication required', 401);
  return req.user.id;
}

export const manualEnrollmentRouter = Router();
const service = new ManualEnrollmentService(supabaseAdmin, new EmailService(mailer));
manualEnrollmentRouter.use(asyncHandler(authenticate), requireRole('admin'));
const course = [
  body('courseType').isIn(['A', 'B']),
  body('automatic').isBoolean({ strict: true }),
  body('cohortId')
    .exists({ values: 'undefined' })
    .bail()
    .custom((v) => v === null || typeof v === 'string')
    .bail(),
  body('cohortId').optional({ values: 'null' }).isUUID(),
];
const practice = [
  body('practice').isObject(),
  body('practice.semanas')
    .isIn([1, 2, 3])
    .custom((v) => typeof v === 'number'),
  body('practice.modalidad').isIn(['entre_semana', 'fin_de_semana']),
  body('practice.fechaInicio').isString(),
  body('practice.fechaFin').optional().isString(),
  body('practice.horasPorDia')
    .isInt({ min: 1, max: 16 })
    .custom((v) => typeof v === 'number'),
  body('practice.horaDeseada').matches(/^([01]\d|2[0-3]):[0-5]\d$/),
  body('practice.horaResuelta')
    .optional()
    .matches(/^([01]\d|2[0-3]):[0-5]\d$/),
  body('practice.instructorId').optional().isUUID(),
];

manualEnrollmentRouter.get(
  '/catalog',
  asyncHandler(async (_req, res) => {
    res.json(await service.catalog());
  }),
);
manualEnrollmentRouter.get(
  '/students',
  [query('q').isString().trim().isLength({ min: 3, max: 254 })],
  validate,
  asyncHandler(async (req, res) => {
    res.json(await service.search(actor(req), req.query.q as string));
  }),
);
manualEnrollmentRouter.post(
  '/course-preview',
  [body('courseType').isIn(['A', 'B'])],
  validate,
  asyncHandler(async (req, res) => {
    res.json(await service.coursePreview((req.body as ManualEnrollmentInput).courseType));
  }),
);
manualEnrollmentRouter.post('/plan', practice, validate, (req: Request, res: Response) => {
  res.json(manualPracticePlan((req.body as { practice: ManualPracticeInput }).practice));
});
manualEnrollmentRouter.post(
  '/practice-preview',
  [...course, ...practice],
  validate,
  asyncHandler(async (req, res) => {
    res.json(await service.practicePreview(req.body as ManualEnrollmentInput));
  }),
);
manualEnrollmentRouter.post(
  '/confirm',
  [
    ...course,
    ...practice,
    header('Idempotency-Key').isUUID(),
    body('student.mode').isIn(['new', 'existing']),
    body('student.id').if(body('student.mode').equals('existing')).isUUID(),
    body('student.cedula')
      .if(body('student.mode').equals('new'))
      .matches(/^\d{10}$/),
    body('student.nombreCompleto')
      .if(body('student.mode').equals('new'))
      .isString()
      .trim()
      .isLength({ min: 1, max: 200 }),
    body('student.correo')
      .if(body('student.mode').equals('new'))
      .isEmail()
      .normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false }),
    body('student.telefono').optional().isString().isLength({ max: 20 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const key = req.get('Idempotency-Key');
    if (!key) throw new AppError('Idempotency-Key is required', 400);
    res.status(200).json(await service.confirm(actor(req), key, req.body as ManualEnrollmentInput));
  }),
);
manualEnrollmentRouter.get(
  '/operations/:id',
  [param('id').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    const op = await service.operation(actor(req), req.params.id);
    res.json({
      operationId: op.id,
      phase: op.phase,
      result: op.response,
      emailStatus: op.email_status,
    });
  }),
);
manualEnrollmentRouter.post(
  '/operations/:id/resend-email',
  [
    param('id').isUUID(),
    body('regenerateTemporaryPassword').optional().isBoolean({ strict: true }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    res.json(
      await service.resend(
        actor(req),
        req.params.id,
        (req.body as { regenerateTemporaryPassword?: boolean }).regenerateTemporaryPassword ===
          true,
      ),
    );
  }),
);
