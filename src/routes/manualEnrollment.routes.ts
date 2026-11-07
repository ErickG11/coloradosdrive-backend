import { Router, type Request, type Response } from 'express';
import { body, header, param, query } from 'express-validator';
import { mailer } from '../config/mailer';
import { supabaseAdmin } from '../config/supabase';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validate, validateFields } from '../middlewares/validate';
import type { ManualEnrollmentInput, ManualPracticeInput } from '../models/manualEnrollment.model';
import { EmailService } from '../services/email.service';
import { ManualEnrollmentService } from '../services/manualEnrollment.service';
import { asyncHandler } from '../utils/asyncHandler';
import { assertBirthDate } from '../utils/birthDate';
import { isValidCedulaEcuatoriana } from '../utils/cedula';
import { isFechaCivil } from '../utils/cohortRules';
import { MANUAL_MESSAGES as M } from '../utils/manualEnrollmentRules';
import { manualPracticePlan, PRACTICE_MESSAGES } from '../utils/manualPracticePlan';
import { HORAS_POR_DIA_MESSAGE, isHorasPorDiaValid } from '../utils/practiceHours';
import { isValidPhone, PHONE_MESSAGE } from '../utils/phone';
import { AppError } from '../utils/AppError';
import { DOCUMENT_TYPES, validateDocumentUpdates, type DocumentInput, type InitialPayment } from '../utils/manualEnrollmentDetails';
import { ManualEnrollmentDetailsService } from '../services/manualEnrollmentDetails.service';
function actor(req: Request): string {
  if (!req.user) throw new AppError('Authentication required', 401);
  return req.user.id;
}

export const manualEnrollmentRouter = Router();
const service = new ManualEnrollmentService(supabaseAdmin, new EmailService(mailer));
const details = new ManualEnrollmentDetailsService(supabaseAdmin);
manualEnrollmentRouter.use(asyncHandler(authenticate), requireRole('admin'));
const isMoney = (value: unknown): boolean =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 &&
  Math.abs(value * 100 - Math.round(value * 100)) < 1e-8;
const documents = [
  body('documentos').optional().isArray({ max: DOCUMENT_TYPES.length })
    .withMessage(M.documentos).bail()
    .custom((value: unknown) => { validateDocumentUpdates(value as DocumentInput[]); return true; }),
  body('documentos.*.tipo').isIn(DOCUMENT_TYPES).withMessage(M.documentos),
  body('documentos.*.estado').isIn(['entregado', 'pendiente', 'no_aplica']).withMessage(M.documentos),
];
const payment = [
  body('pago').optional().isObject().withMessage(M.pagoObjeto),
  body('pago.modalidad').if(body('pago').exists()).isIn(['abono', 'completo'])
    .withMessage(M.modalidadPago),
  body('pago.descuento').if(body('pago').exists()).custom(isMoney).withMessage(M.descuento),
  body('pago.montoAbonado').if(body('pago').exists()).custom(isMoney).withMessage(M.montoAbonado),
];
const course = [
  body('courseType').isIn(['A', 'B']).withMessage(M.tipoCurso),
  body('automatic').isBoolean({ strict: true }).withMessage(M.automatic),
  body('cohortId')
    .exists({ values: 'undefined' })
    .bail()
    .custom((v) => v === null || typeof v === 'string')
    .withMessage(M.cohorte)
    .bail(),
  body('cohortId').optional({ values: 'null' }).isUUID().withMessage(M.cohorte),
];
const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const practice = [
  body('practice').isObject().withMessage(M.practice),
  body('practice.semanas')
    .isIn([1, 2, 3])
    .custom((v) => typeof v === 'number')
    .withMessage(M.semanas),
  body('practice.modalidad').isIn(['entre_semana', 'fin_de_semana']).withMessage(M.modalidad),
  body('practice.fechaInicio')
    .custom((v) => typeof v === 'string' && v.trim() !== '')
    .withMessage(M.fechaInicioObligatoria)
    .bail()
    .custom((v: string) => isFechaCivil(v))
    .withMessage(PRACTICE_MESSAGES.fechaInicio),
  body('practice.fechaFin')
    .optional()
    .custom((v) => typeof v === 'string' && isFechaCivil(v))
    .withMessage(PRACTICE_MESSAGES.fechaFin)
    .bail()
    .custom((fin: string, { req }) => {
      const inicio = (req.body as { practice?: { fechaInicio?: unknown } }).practice?.fechaInicio;
      return typeof inicio !== 'string' || !isFechaCivil(inicio) || fin >= inicio;
    })
    .withMessage(PRACTICE_MESSAGES.fechaFinAnterior),
  body('practice.horasPorDia')
    .custom((v) => v !== undefined && v !== null && v !== '')
    .withMessage(M.horasPorDiaObligatoria)
    .bail()
    .custom(isHorasPorDiaValid)
    .withMessage(HORAS_POR_DIA_MESSAGE),
  body('practice.horaDeseada')
    .custom((v) => typeof v === 'string' && v !== '')
    .withMessage(M.horaObligatoria)
    .bail()
    .matches(HORA_REGEX)
    .withMessage(PRACTICE_MESSAGES.horaDeseada),
  body('practice.horaResuelta')
    .optional()
    .matches(HORA_REGEX)
    .withMessage(PRACTICE_MESSAGES.horaDeseada),
  body('practice.instructorId').optional().isUUID().withMessage(M.instructor),
];
const newStudent = body('student.mode').equals('new');
const studentNew = [
  body('student.cedula')
    .if(newStudent)
    .custom((v) => typeof v === 'string' && v.trim() !== '')
    .withMessage(M.cedulaObligatoria)
    .bail()
    .custom((v: string) => isValidCedulaEcuatoriana(v))
    .withMessage(M.cedula),
  body('student.nombreCompleto')
    .if(newStudent)
    .custom((v) => typeof v === 'string' && v.trim() !== '')
    .withMessage(M.nombreObligatorio)
    .bail()
    .trim()
    .isLength({ max: 200 })
    .withMessage(M.nombreLargo)
    .bail()
    .custom((v: string) => /\p{L}/u.test(v) && !/\d/.test(v))
    .withMessage(M.nombre),
  body('student.correo')
    .if(newStudent)
    .custom((v) => typeof v === 'string' && v.trim() !== '')
    .withMessage(M.correoObligatorio)
    .bail()
    .isLength({ max: 254 })
    .withMessage(M.correoLargo)
    .bail()
    .isEmail()
    .withMessage(M.correo)
    .normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false }),
  body('student.telefono')
    .if(newStudent)
    .optional({ values: 'falsy' })
    .custom((v) => typeof v === 'string')
    .withMessage(PHONE_MESSAGE)
    .bail()
    .trim()
    .custom((v: string) => v === '' || isValidPhone(v))
    .withMessage(PHONE_MESSAGE),
  body('student.fechaNacimiento')
    .if(newStudent)
    .optional({ values: 'falsy' })
    .custom(assertBirthDate),
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
// Solo existe o no por campo, sin datos personales (el servidor sigue
// validando al confirmar). POST para que cédula y correo no viajen en la URL.
manualEnrollmentRouter.post(
  '/duplicates',
  [
    body().custom((v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v) &&
      Object.keys(v).every((k) => ['cedula', 'correo'].includes(k)) &&
      ('cedula' in v || 'correo' in v)).withMessage(M.duplicadosCuerpo),
    body('cedula').optional().custom((v) => typeof v === 'string' && isValidCedulaEcuatoriana(v))
      .withMessage(M.cedula),
    body('correo').optional()
      .custom((v) => typeof v === 'string' && v.length <= 254).withMessage(M.correoLargo).bail()
      .isEmail().withMessage(M.correo)
      .normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false }),
  ],
  validateFields,
  asyncHandler(async (req, res) => {
    res.json(await service.duplicates(actor(req), req.body as { cedula?: string; correo?: string }));
  }),
);
manualEnrollmentRouter.post(
  '/course-preview',
  [body('courseType').isIn(['A', 'B']).withMessage(M.tipoCurso)],
  validateFields,
  asyncHandler(async (req, res) => {
    res.json(await service.coursePreview((req.body as ManualEnrollmentInput).courseType));
  }),
);
manualEnrollmentRouter.post('/plan', practice, validateFields, (req: Request, res: Response) => {
  res.json(manualPracticePlan((req.body as { practice: ManualPracticeInput }).practice));
});
manualEnrollmentRouter.post(
  '/practice-preview',
  [...course, ...practice],
  validateFields,
  asyncHandler(async (req, res) => {
    res.json(await service.practicePreview(req.body as ManualEnrollmentInput));
  }),
);
manualEnrollmentRouter.post(
  '/confirm',
  [
    ...course,
    ...practice,
    header('Idempotency-Key').isUUID().withMessage(M.idempotencia),
    body('student.mode').isIn(['new', 'existing']).withMessage(M.studentMode),
    body('student.id').if(body('student.mode').equals('existing')).isUUID()
      .withMessage(M.studentId),
    ...studentNew,
    ...documents,
    ...payment,
  ],
  validateFields,
  asyncHandler(async (req, res) => {
    const key = req.get('Idempotency-Key');
    if (!key) throw new AppError('Idempotency-Key is required', 400);
    res.status(200).json(await service.confirm(actor(req), key, req.body as ManualEnrollmentInput));
  }),
);
manualEnrollmentRouter.get(
  '/:enrollmentId/details',
  [param('enrollmentId').isUUID()], validate,
  asyncHandler(async (req, res) => {
    res.json(await details.get(req.params.enrollmentId));
  }),
);
manualEnrollmentRouter.patch(
  '/:enrollmentId/details',
  [
    param('enrollmentId').isUUID(),
    body().custom((value: unknown) => !!value && typeof value === 'object' &&
      Object.keys(value).length > 0 &&
      Object.keys(value).every((key) => ['documentos', 'pago'].includes(key))),
    ...documents,
    ...payment,
  ], validate,
  asyncHandler(async (req, res) => {
    res.json(await details.update(actor(req), req.params.enrollmentId,
      req.body as { documentos?: DocumentInput[]; pago?: InitialPayment }));
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
