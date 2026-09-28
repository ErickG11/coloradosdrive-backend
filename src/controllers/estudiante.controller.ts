import type { Request, Response } from 'express';

import { supabaseAdmin } from '../config/supabase';
import type { ChangePasswordInput } from '../models/user.model';
import { UserService } from '../services/user.service';
import { AppError } from '../utils/AppError';

const userService = new UserService(supabaseAdmin);

function requireStudentId(req: Request): string {
  if (!req.user) {
    throw new AppError('Authentication required', 401);
  }
  return req.user.id;
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const studentId = requireStudentId(req);
  const { nuevaPassword } = req.body as ChangePasswordInput;

  await userService.changeOwnPassword(studentId, nuevaPassword);

  res.status(200).json({ message: 'Contraseña actualizada correctamente' });
}
