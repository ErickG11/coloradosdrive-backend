import { enrollmentRuleEnabled } from '../services/enrollmentRuleFlags.service';
import { throwStudentScheduleError } from '../utils/studentScheduleError';
import { Router, type Request } from 'express';
import { assertBirthDate, BIRTH_DATE_MESSAGES } from '../utils/birthDate';
import { body, param, query } from 'express-validator';
import { supabaseAdmin } from '../config/supabase';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validate, validateStudentProfile } from '../middlewares/validate';
import { StudentIdentityService } from '../services/studentIdentity.service';
import { StudentAdminService } from '../services/studentAdmin.service';
import { StudentAccessService } from '../services/studentAccess.service';
import { StudentAccessLinkService } from '../services/studentAccessLink.service';
import { AccountService } from '../services/account.service';
import { EmailService } from '../services/email.service';
import { mailer } from '../config/mailer';
import { StudentDeletionService } from '../services/studentDeletion.service';
import { StudentCohortService } from '../services/studentCohort.service';
import {
  StudentProfileService,
  profileFields,
  type StudentProfilePatch,
} from '../services/studentProfile.service';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';

export const studentAdminRouter = Router();
const service = new StudentAdminService(supabaseAdmin);
const profileService = new StudentProfileService(supabaseAdmin);
const accessService = new StudentAccessService(supabaseAdmin);
const deletionService = new StudentDeletionService(supabaseAdmin);
const cohortService = new StudentCohortService(supabaseAdmin);
studentAdminRouter.use(asyncHandler(authenticate), requireRole('admin'));

function actor(req: Request): string {
  if (!req.user) throw new AppError('Authentication required', 401);
  return req.user.id;
}

studentAdminRouter.get(
  '/:id/matriculas/acceso',
  param('id').isUUID(),
  validate,
  asyncHandler(async (req, res) => {
    const flag = await supabaseAdmin
      .from('enrollment_rule_flags')
      .select('enabled,implemented')
      .eq('key', 'enrollment_access')
      .single();
    if (flag.error) throwStudentScheduleError(flag.error);
    if (!flag.data.enabled || !flag.data.implemented) {
      res.json({ active: false, serverNow: new Date().toISOString(), enrollments: [] });
      return;
    }
    const result = await supabaseAdmin.rpc('admin_enrollment_access_v2', {
      p_actor: actor(req),
      p_student: req.params.id,
    });
    if (result.error) throwStudentScheduleError(result.error);
    res.set('Cache-Control', 'no-store').json(result.data);
  }),
);
studentAdminRouter.patch(
  '/:id/matriculas/:enrollmentId/acceso',
  param('id').isUUID(),
  param('enrollmentId').isUUID(),
  body('fin').isISO8601({ strict: true }),
  body('motivo').isString().isLength({ min: 1, max: 500 }),
  validate,
  asyncHandler(async (req, res) => {
    const { fin, motivo } = req.body as { fin: string; motivo: string };
    const own = await supabaseAdmin.rpc('admin_enrollment_access_v2', {
      p_actor: actor(req),
      p_student: req.params.id,
    });
    if (own.error) throwStudentScheduleError(own.error);
    if (!own.data.enrollments.some((e) => e.id === req.params.enrollmentId))
      throw new AppError('Matrícula no encontrada.', 404, { code: 'MATRICULA_NO_ENCONTRADA' });
    const result = await supabaseAdmin.rpc('extend_enrollment_access_v2', {
      p_actor: actor(req),
      p_enrollment: req.params.enrollmentId,
      p_end: fin,
      p_reason: motivo,
    });
    if (result.error) throwStudentScheduleError(result.error);
    res.json(result.data);
  }),
);
studentAdminRouter.post(
  '/:id/matriculas/repeticion',
  param('id').isUUID(),
  body('courseId').isUUID(),
  body('motivo').isString().isLength({ min: 1, max: 500 }),
  validate,
  asyncHandler(async (req, res) => {
    const { courseId, motivo } = req.body as { courseId: string; motivo: string };
    const result = await supabaseAdmin.rpc('authorize_repeat_enrollment_v2', {
      p_actor: actor(req),
      p_student: req.params.id,
      p_course: courseId,
      p_reason: motivo,
    });
    if (result.error) throwStudentScheduleError(result.error);
    res.status(201).json({ id: result.data });
  }),
);
studentAdminRouter.get(
  '/espera/resumen',
  asyncHandler(async (req, res) => {
    if (!(await enrollmentRuleEnabled(supabaseAdmin, 'waitlist'))) {
      res.json({ active: false, A: 0, B: 0 });
      return;
    }
    const result = await supabaseAdmin.rpc('admin_waitlist_counts_v2', { p_actor: actor(req) });
    if (result.error) throwStudentScheduleError(result.error);
    res.json(result.data);
  }),
);
studentAdminRouter.post(
  '/espera/reintentar',
  body('tipo').isIn(['A', 'B']),
  body('motivo').isString().isLength({ min: 1, max: 500 }),
  validate,
  asyncHandler(async (req, res) => {
    if (!(await enrollmentRuleEnabled(supabaseAdmin, 'waitlist')))
      throw new AppError('Los avisos de apertura aún no están habilitados.', 409, {
        code: 'ESPERA_REGLAS_INACTIVAS',
      });
    const { tipo, motivo } = req.body as { tipo: 'A' | 'B'; motivo: string };
    const result = await supabaseAdmin.rpc('retry_waitlist_emails_v2', {
      p_actor: actor(req),
      p_type: tipo,
      p_reason: motivo,
    });
    if (result.error) throwStudentScheduleError(result.error);
    res.json({ retried: result.data });
  }),
);
const listFields = [
  'q',
  'interesadoEn',
  'activo',
  'courseId',
  'cohortId',
  'pendienteCohorte',
  'documentosPendientes',
  'incluirHistorial',
  'page',
  'pageSize',
];
studentAdminRouter.get(
  '/',
  [
    query().custom((value: Record<string, unknown>) =>
      Object.keys(value).every((k) => listFields.includes(k)),
    ),
    query('interesadoEn').optional().isIn(['A', 'B']),
    query('q').optional().isString().trim().isLength({ min: 1, max: 80 }),
    ...['activo', 'pendienteCohorte', 'documentosPendientes', 'incluirHistorial'].map((name) =>
      query(name).optional().isIn(['true', 'false']),
    ),
    query('courseId').optional().isUUID(),
    query('cohortId').optional().isUUID(),
    query('page').optional().isInt({ min: 1, max: 100000 }),
    query('pageSize').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const boolean = (name: string): boolean | undefined =>
      req.query[name] === undefined ? undefined : req.query[name] === 'true';
    res.json(
      await service.list(actor(req), {
        q: req.query.q as string | undefined,
        interesadoEn: req.query.interesadoEn as 'A' | 'B' | undefined,
        courseId: req.query.courseId as string | undefined,
        cohortId: req.query.cohortId as string | undefined,
        activo: boolean('activo'),
        pendienteCohorte: boolean('pendienteCohorte'),
        documentosPendientes: boolean('documentosPendientes'),
        incluirHistorial: boolean('incluirHistorial'),
        page: Number(req.query.page ?? 1),
        pageSize: Number(req.query.pageSize ?? 20),
      }),
    );
  }),
);

const id = param('id').isUUID();
const cohortPath = '/:id/matriculas/:enrollmentId';
studentAdminRouter.get(
  `${cohortPath}/cohortes`,
  [param('id').isUUID(), param('enrollmentId').isUUID()],
  validateStudentProfile,
  asyncHandler(async (req, res) => {
    res.json(await cohortService.options(req.params.id, req.params.enrollmentId));
  }),
);
studentAdminRouter.post(
  `${cohortPath}/asignar-cohorte`,
  [
    param('id').isUUID(),
    param('enrollmentId').isUUID(),
    body().custom(
      (value: unknown) =>
        !!value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.keys(value).every((key) => key === 'cohortId'),
    ),
    body('cohortId').isUUID().withMessage('Selecciona una cohorte válida'),
  ],
  validateStudentProfile,
  asyncHandler(async (req, res) => {
    res.json(
      await cohortService.assign(
        actor(req),
        req.params.id,
        req.params.enrollmentId,
        (req.body as { cohortId: string }).cohortId,
      ),
    );
  }),
);
// Ruta estática antes de /:id: también funciona sin perfil.
studentAdminRouter.get(
  '/eliminaciones',
  [
    query().custom((q: Record<string, unknown>) =>
      Object.keys(q).every((k) => ['page', 'pageSize', 'estado'].includes(k)),
    ),
    query('page').optional().isInt({ min: 1, max: 100000 }),
    query('pageSize').optional().isInt({ min: 1, max: 100 }),
    query('estado').optional().isIn(['pendiente', 'fallido']),
  ],
  validate,
  asyncHandler(async (req, res) => {
    res.json(
      await deletionService.list(
        Number(req.query.page ?? 1),
        Number(req.query.pageSize ?? 20),
        req.query.estado as 'pendiente' | 'fallido' | undefined,
      ),
    );
  }),
);
studentAdminRouter.post(
  '/:id/eliminar',
  [
    param('id').isUUID(),
    body().custom(
      (value: unknown) =>
        !!value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.keys(value).every((k) => k === 'confirmacionCedula'),
    ),
    body('confirmacionCedula')
      .optional()
      .isString()
      .matches(/^\d{10}$/)
      .withMessage('Confirmación inválida'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    // Nunca registrar body ni trasladarlo a mensajes de error.
    res.json(
      await deletionService.remove(
        actor(req),
        req.params.id,
        (req.body as { confirmacionCedula?: string }).confirmacionCedula,
      ),
    );
  }),
);
for (const [action, active] of [
  ['desactivar', false],
  ['reactivar', true],
] as const) {
  studentAdminRouter.post(
    `/:id/${action}`,
    [param('id').isUUID()],
    validate,
    asyncHandler(async (req, res) => {
      res.json(await accessService.setActive(actor(req), req.params.id, active));
    }),
  );
}
studentAdminRouter.get(
  '/:id/reservas-pendientes',
  [param('id').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    res.json(await accessService.reservations(req.params.id));
  }),
);
studentAdminRouter.patch(
  '/:id',
  [
    id,
    body().custom((input: unknown) => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
      const value = input as Record<string, unknown>;
      return (
        Object.keys(value).every((key) =>
          ['updatedAt', 'correo', ...Object.keys(profileFields)].includes(key),
        ) && Object.keys(value).some((key) => key !== 'updatedAt')
      );
    }),
    body('updatedAt')
      .isString()
      .bail()
      .matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/)
      .bail()
      .isISO8601({ strict: true, strictSeparator: true }),
    body('correo').optional().isString().isEmail().isLength({ max: 254 }),
    body('cedula')
      .optional()
      .isString()
      .matches(/^\d{10}$/),
    body('nombreCompleto').optional().isString().trim().isLength({ min: 1, max: 200 }),
    body('fechaNacimiento')
      .optional({ nullable: true })
      .isString()
      .bail()
      .matches(/^\d{4}-\d{2}-\d{2}$/)
      .withMessage(BIRTH_DATE_MESSAGES.invalida)
      .bail()
      .custom(assertBirthDate),
    ...Object.entries({
      telefono: 20,
      direccion: 500,
      tipoSangre: 500,
      genero: 500,
      ciudadania: 500,
    }).map(([field, max]) =>
      body(field)
        .optional({ nullable: true })
        .isString()
        .bail()
        .trim()
        .isLength({ max })
        .withMessage(`${field} no puede superar ${String(max)} caracteres`),
    ),
  ],
  validateStudentProfile,
  asyncHandler(async (req, res) => {
    res.json(
      await profileService.update(actor(req), req.params.id, req.body as StudentProfilePatch),
    );
  }),
);
studentAdminRouter.get(
  '/:id',
  [id],
  validate,
  asyncHandler(async (req, res) => {
    res.json(await service.get(req.params.id));
  }),
);

// B1 (F17): reenvío auditado del enlace de un solo uso para crear la contraseña.
const accessLinkService = new StudentAccessLinkService(
  supabaseAdmin,
  new EmailService(mailer),
  new AccountService(supabaseAdmin),
);
studentAdminRouter.post(
  '/:id/reenviar-enlace-acceso',
  [param('id').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    res
      .set('Cache-Control', 'no-store')
      .json(await accessLinkService.reenviar(actor(req), req.params.id));
  }),
);

const identityService = new StudentIdentityService(supabaseAdmin);
studentAdminRouter.post(
  '/:id/identidad-presencial',
  [param('id').isUUID().withMessage('Alumno inválido')],
  validateStudentProfile,
  asyncHandler(async (req, res) => {
    res
      .set('Cache-Control', 'no-store')
      .json(await identityService.confirmar(req.params.id, actor(req), req.body as unknown));
  }),
);
