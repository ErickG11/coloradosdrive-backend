import { Router, type Request } from 'express';
import { param, query } from 'express-validator';
import { supabaseAdmin } from '../config/supabase';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate';
import { StudentAdminService } from '../services/studentAdmin.service';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';

export const studentAdminRouter = Router();
const service = new StudentAdminService(supabaseAdmin);
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
studentAdminRouter.get(
  '/:id',
  [id],
  validate,
  asyncHandler(async (req, res) => {
    res.json(await service.get(req.params.id));
  }),
);
