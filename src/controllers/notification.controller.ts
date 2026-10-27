import type { Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { NotificationService } from '../services/notification.service';
import { AppError } from '../utils/AppError';

const service = new NotificationService(supabaseAdmin);
function owner(req: Request): string {
  if (!req.user) throw new AppError('Debes iniciar sesión', 401);
  return req.user.id;
}

export async function listNotifications(req: Request, res: Response): Promise<void> {
  res.json(await service.list(owner(req), Number(req.query.page ?? 1), Number(req.query.pageSize ?? 20)));
}
export async function markNotificationRead(req: Request, res: Response): Promise<void> {
  res.json(await service.markRead(owner(req), req.params.id));
}
export async function readAllNotifications(req: Request, res: Response): Promise<void> {
  res.json(await service.readAll(owner(req)));
}
