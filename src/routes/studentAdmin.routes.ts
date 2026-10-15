import { Router, type Request } from 'express';
import { body, param, query } from 'express-validator';
import { supabaseAdmin } from '../config/supabase';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validate, validateStudentProfile } from '../middlewares/validate';
import { StudentAdminService } from '../services/studentAdmin.service';
import { StudentAccessService } from '../services/studentAccess.service';
import { StudentDeletionService } from '../services/studentDeletion.service';
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
studentAdminRouter.use(asyncHandler(authenticate), requireRole('admin'));

function actor(req: Request): string {
  if (!req.user) throw new AppError('Authentication required', 401);
  return req.user.id;
}

const listFields = [
  'q',
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
      .bail()
      .isISO8601({ strict: true })
      .custom((value: string) => !value.startsWith('0000-')),
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
