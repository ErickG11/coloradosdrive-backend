import { Router } from 'express';
import { param, query } from 'express-validator';
import { listNotifications, markNotificationRead, readAllNotifications } from '../controllers/notification.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validateFields } from '../middlewares/validate';
import { asyncHandler } from '../utils/asyncHandler';

export const notificationRouter = Router();
notificationRouter.use(asyncHandler(authenticate), requireRole('estudiante', 'instructor'));
notificationRouter.get('/', [
  query('page').optional().custom((value: unknown) => typeof value === 'string').withMessage('page debe ser un único número')
    .bail().isInt({ min: 1, max: 1_000_000 }).withMessage('page debe ser un entero entre 1 y 1000000'),
  query('pageSize').optional().custom((value: unknown) => typeof value === 'string').withMessage('pageSize debe ser un único número')
    .bail().isInt({ min: 1, max: 100 }).withMessage('pageSize debe ser un entero entre 1 y 100'),
], validateFields, asyncHandler(listNotifications));
notificationRouter.patch('/:id/read', param('id').isUUID().withMessage('id debe ser un UUID válido'),
  validateFields, asyncHandler(markNotificationRead));
notificationRouter.post('/read-all', asyncHandler(readAllNotifications));
