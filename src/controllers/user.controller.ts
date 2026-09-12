import type { Request, Response } from 'express';

import { supabaseAdmin } from '../config/supabase';
import type { Role, UserSummary } from '../models/user.model';
import { UserService } from '../services/user.service';

const userService = new UserService(supabaseAdmin);

export async function listUsers(req: Request, res: Response<UserSummary[]>): Promise<void> {
  const users = await userService.listByRole(req.query.rol as Role);
  res.status(200).json(users);
}
