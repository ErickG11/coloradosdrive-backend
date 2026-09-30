import { Router, type Request } from 'express';
import { body, param, query } from 'express-validator';

import { mailer } from '../config/mailer';
import { supabaseAdmin } from '../config/supabase';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate';
import { EmailService } from '../services/email.service';
import { InstructorService, type InstructorInput } from '../services/instructor.service';
import { UserService } from '../services/user.service';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { isValidCedulaEcuatoriana } from '../utils/cedula';

export const instructorAdminRouter = Router();
export const instructorSelfRouter = Router();
const service = new InstructorService(supabaseAdmin, new EmailService(mailer));
const users = new UserService(supabaseAdmin);

function ownId(req: Request): string {
  if (!req.user) throw new AppError('Authentication required', 401);
  return req.user.id;
}

function onlyFields(allowed: string[]): ReturnType<typeof body> {
  return body().custom((value: unknown) =>
    (value === undefined && allowed.length === 0) ||
    (!!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every((key) => allowed.includes(key))));
}

const id = param('id').isUUID().withMessage('id debe ser un UUID válido');
const name = (): ReturnType<typeof body> =>
  body('nombreCompleto').isString().trim().isLength({ min: 1, max: 200 });
const phone = (): ReturnType<typeof body> =>
  body('telefono').isString().trim().matches(/^\+?[0-9() -]{7,20}$/)
    .custom((value: string) => value.replace(/\D/g, '').length >= 7);

instructorAdminRouter.use(asyncHandler(authenticate), requireRole('admin'));

instructorAdminRouter.post('/', [
  onlyFields(['cedula', 'nombreCompleto', 'telefono', 'correo']),
  body('cedula').isString().custom((value: string) => isValidCedulaEcuatoriana(value))
    .withMessage('cedula debe ser una cédula ecuatoriana válida'),
  name(), phone(),
  body('correo').isEmail().normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false }),
], validate, asyncHandler(async (req, res) => {
  res.status(201).json(await service.create(req.body as InstructorInput));
}));

instructorAdminRouter.get('/', [
  query().custom((value: unknown) => !!value && typeof value === 'object' &&
    Object.keys(value).every((key) => ['q', 'activo', 'page', 'pageSize'].includes(key))),
  query('q').optional().isString().trim().isLength({ min: 1, max: 80 })
    .matches(/^[\p{L}\p{N} -]+$/u),
  query('activo').optional().isIn(['true', 'false']),
  query('page').optional().isInt({ min: 1, max: 100000 }),
  query('pageSize').optional().isInt({ min: 1, max: 100 }),
], validate, asyncHandler(async (req, res) => {
  res.json(await service.list({
    q: typeof req.query.q === 'string' ? req.query.q : undefined,
    activo: req.query.activo === undefined ? undefined : req.query.activo === 'true',
    page: req.query.page === undefined ? 1 : Number(req.query.page),
    pageSize: req.query.pageSize === undefined ? 20 : Number(req.query.pageSize),
  }));
}));

instructorAdminRouter.get('/:id', id, validate, asyncHandler(async (req, res) => {
  res.json(await service.get(req.params.id));
}));

instructorAdminRouter.patch('/:id', [
  id, onlyFields(['nombreCompleto', 'telefono']),
  body().custom((value: unknown) => !!value && typeof value === 'object' &&
    Object.keys(value).length > 0),
  name().optional(), phone().optional(),
], validate, asyncHandler(async (req, res) => {
  res.json(await service.update(req.params.id, req.body as {
    nombreCompleto?: string; telefono?: string;
  }));
}));

instructorAdminRouter.post('/:id/desactivar', [id, onlyFields([])], validate,
  asyncHandler(async (req, res) => { res.json(await service.setActive(req.params.id, false)); }));
instructorAdminRouter.post('/:id/reactivar', [id, onlyFields([])], validate,
  asyncHandler(async (req, res) => { res.json(await service.setActive(req.params.id, true)); }));
instructorAdminRouter.post('/:id/reenviar-credenciales', [id, onlyFields([])], validate,
  asyncHandler(async (req, res) => {
    await service.resendCredentials(req.params.id);
    res.status(204).send();
  }));

instructorSelfRouter.use(asyncHandler(authenticate), requireRole('instructor'));
instructorSelfRouter.get('/account-status', asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin.from('users')
    .select('debe_cambiar_password').eq('id', ownId(req)).single();
  if (error) throw new AppError('No se pudo consultar el estado de la cuenta', 500);
  res.json({ mustChangePassword: data.debe_cambiar_password });
}));
instructorSelfRouter.post('/cambiar-password', [
  onlyFields(['nuevaPassword']),
  body('nuevaPassword').isString().isLength({ min: 8, max: 128 }),
], validate, asyncHandler(async (req, res) => {
  try {
    await users.changeOwnPassword(ownId(req), (req.body as { nuevaPassword: string }).nuevaPassword);
  } catch {
    throw new AppError('No se pudo cambiar la contraseña', 502);
  }
  res.status(204).send();
}));
instructorSelfRouter.get('/me', asyncHandler(async (req, res) => {
  res.json(await service.own(ownId(req)));
}));
