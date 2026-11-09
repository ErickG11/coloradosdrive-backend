import { Router } from 'express';
import type { RequestHandler, Request } from 'express';
import { body, param, query, matchedData } from 'express-validator';
import type { ValidationChain } from 'express-validator';
import multer from 'multer';
import { supabaseAdmin } from '../config/supabase';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate';
import { ContentService, contentError } from '../services/content.service';
import type { ContentData } from '../models/content.model';
import { asyncHandler } from '../utils/asyncHandler';

function actor(req: Request): string {
  if (!req.user) throw contentError('ACCESS_DENIED', 401);
  return req.user.id;
}
const service = new ContentService(supabaseAdmin);
export const contentAdminRouter = Router();
export const contentStudentRouter = Router();
contentAdminRouter.use(asyncHandler(authenticate), requireRole('admin'));
contentStudentRouter.use(asyncHandler(authenticate), requireRole('estudiante'));
const id = (): ValidationChain => param('id').isUUID();
const uuid = (key: string): ValidationChain => body(key).isUUID();
const title = (optional = false): ValidationChain => {
  const chain = body('title');
  return (optional ? chain.optional() : chain).isString().trim().isLength({ min: 1, max: 120 });
};
const metadata = (): ValidationChain[] => [
  body('description').optional({ nullable: true }).isString().isLength({ max: 20000 }),
  body('is_published').optional().isBoolean().toBoolean(),
];
const ordering = (): ValidationChain[] => [
  body('order_index').optional().isInt({ min: 0, max: 100000 }).toInt(),
];
const reorder = (): ValidationChain[] => [
  body('ids').isArray({ max: 1000 }),
  body('ids.*').isUUID(),
];
const handle = (action: string): RequestHandler =>
  asyncHandler(async (req, res) => {
    if (!req.user) throw contentError('ACCESS_DENIED', 401);
    const data = matchedData<ContentData>(req, { includeOptionals: true });
    res.json(await service.admin(req.user.id, action, data));
  });

contentAdminRouter.get(
  '/courses/:course_id/subjects',
  param('course_id').isUUID(),
  validate,
  handle('subjects.list'),
);
contentAdminRouter.post(
  '/subjects',
  uuid('course_id'),
  title(),
  ...metadata(),
  ...ordering(),
  validate,
  handle('subjects.save'),
);
contentAdminRouter.patch(
  '/subjects/:id',
  id(),
  title(true),
  ...metadata(),
  ...ordering(),
  validate,
  handle('subjects.save'),
);
contentAdminRouter.delete('/subjects/:id', id(), validate, handle('subjects.delete'));
contentAdminRouter.put(
  '/courses/:course_id/subjects/order',
  param('course_id').isUUID(),
  ...reorder(),
  validate,
  handle('subjects.reorder'),
);

contentAdminRouter.get('/materials', handle('materials.list'));
const materialFields = (): ValidationChain[] => [
  title(),
  ...metadata(),
  body('kind').isIn(['enlace', 'texto']),
  body('url')
    .optional()
    .isURL({ protocols: ['https'], require_protocol: true, require_tld: false }),
  body('body').optional().isString().isLength({ min: 1, max: 20000 }),
];
contentAdminRouter.post('/materials', ...materialFields(), validate, handle('materials.save'));
contentAdminRouter.patch(
  '/materials/:id',
  id(),
  title(true),
  ...metadata(),
  body('url')
    .optional()
    .isURL({ protocols: ['https'], require_protocol: true, require_tld: false }),
  body('body').optional().isString().isLength({ min: 1, max: 20000 }),
  validate,
  handle('materials.save'),
);
contentAdminRouter.delete(
  '/materials/:id',
  id(),
  validate,
  asyncHandler(async (req, res) => {
    const material = (await service.admin(actor(req), 'materials.delete', {
      id: req.params.id,
    })) as ContentData;
    if (typeof material.storage_path === 'string') {
      const cleanup = await supabaseAdmin.storage
        .from('course-content')
        .remove([material.storage_path]);
      // La fila ya se borró; informar un objeto pendiente sin deshacer una eliminación confirmada.
      res.json({ deleted: true, storage_cleanup_pending: Boolean(cleanup.error) });
    } else res.json({ deleted: true });
  }),
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 3, fieldSize: 20000 },
});
contentAdminRouter.post(
  '/materials/upload',
  (req, res, next) => {
    upload.single('file')(req, res, (error: unknown) => {
      next(
        error
          ? contentError(
              'INVALID_UPLOAD',
              error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
            )
          : undefined,
      );
    });
  },
  title(),
  body('description').optional().isString().isLength({ max: 20000 }),
  validate,
  asyncHandler(async (req, res) => {
    if (!req.file) throw contentError('FILE_REQUIRED', 400);
    res.status(201).json(await service.upload(actor(req), req.file, matchedData<ContentData>(req)));
  }),
);

contentAdminRouter.get(
  '/subjects/:subject_id/items',
  param('subject_id').isUUID(),
  validate,
  handle('items.list'),
);
contentAdminRouter.post(
  '/items',
  uuid('subject_id'),
  body('kind').isIn(['material', 'examen']),
  body('material_id').optional().isUUID(),
  body('exam_id').optional().isUUID(),
  ...ordering(),
  body('obligatorio').optional().isBoolean().toBoolean(),
  validate,
  handle('items.save'),
);
contentAdminRouter.patch(
  '/items/:id',
  id(),
  body('subject_id').optional().isUUID(),
  ...ordering(),
  body('obligatorio').optional().isBoolean().toBoolean(),
  validate,
  handle('items.save'),
);
contentAdminRouter.delete('/items/:id', id(), validate, handle('items.delete'));
contentAdminRouter.put(
  '/subjects/:subject_id/items/order',
  param('subject_id').isUUID(),
  ...reorder(),
  validate,
  handle('items.reorder'),
);

function offsetDate(value: unknown): boolean {
  if (value === null) return true;
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error('Fecha ISO con zona obligatoria');
  return true;
}
contentAdminRouter.get(
  '/items/:item_id/rules',
  param('item_id').isUUID(),
  validate,
  handle('rules.list'),
);
contentAdminRouter.put(
  '/access-rules',
  body('scope').isIn(['item', 'materia', 'curso']),
  uuid('scope_id'),
  body('target_type').isIn(['cohorte', 'estudiante']),
  uuid('target_id'),
  body('habilitado').optional().isBoolean().toBoolean(),
  body('opens_at').optional({ nullable: true }).isISO8601({ strict: true }).custom(offsetDate),
  // El futuro de la fecha lo valida SQL usando su reloj; aquí solo se valida el formato.
  body('closes_at').optional({ nullable: true }).isISO8601({ strict: true }).custom(offsetDate),
  body('max_attempts').optional({ nullable: true }).isInt({ min: 1, max: 20 }).toInt(),
  body('extra_minutes').optional().isInt({ min: 0, max: 180 }).toInt(),
  body('note').optional({ nullable: true }).isString().isLength({ max: 300 }),
  validate,
  handle('rules.set'),
);
contentAdminRouter.get(
  '/exams/:exam_id/results',
  param('exam_id').isUUID(),
  query('cohort_id').optional().isUUID(),
  validate,
  handle('results'),
);
contentAdminRouter.get(
  '/students/:student_id/courses/:course_id/progress',
  param('student_id').isUUID(),
  param('course_id').isUUID(),
  validate,
  handle('progress.student'),
);
contentAdminRouter.get(
  '/cohorts/:cohort_id/progress',
  param('cohort_id').isUUID(),
  validate,
  handle('progress.cohort'),
);

contentStudentRouter.get(
  '/courses',
  asyncHandler(async (req, res) => {
    res.json(await service.student(actor(req), 'courses'));
  }),
);
contentStudentRouter.get(
  '/course',
  query('course_id').optional().isUUID(),
  validate,
  asyncHandler(async (req, res) => {
    res.json(
      await service.student(
        actor(req),
        'catalog',
        matchedData<ContentData>(req, { locations: ['query'] }),
      ),
    );
  }),
);
contentStudentRouter.post(
  '/items/:id/open',
  id(),
  validate,
  asyncHandler(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await service.open(actor(req), req.params.id));
  }),
);
contentStudentRouter.put(
  '/items/:id/completed',
  id(),
  body('completed').isBoolean().toBoolean(),
  validate,
  asyncHandler(async (req, res) => {
    res.json(
      await service.student(actor(req), 'complete', {
        item_id: req.params.id,
        completed: matchedData<ContentData>(req).completed,
      }),
    );
  }),
);
