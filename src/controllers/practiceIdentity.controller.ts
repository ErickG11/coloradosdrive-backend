import type { Request, Response } from 'express';

import { supabaseAdmin } from '../config/supabase';
import { PracticeIdentityService } from '../services/practiceIdentity.service';
import type { IdentidadPresencialResultado } from '../services/practiceIdentity.service';
import { AppError } from '../utils/AppError';

export const practiceIdentityService = new PracticeIdentityService(supabaseAdmin);

export async function confirmPracticeIdentity(
  req: Request,
  res: Response<IdentidadPresencialResultado>,
): Promise<void> {
  if (!req.user) throw new AppError('Authentication required', 401);
  const { certificadoOriginalVisto } = req.body as { certificadoOriginalVisto?: boolean };
  const result = await practiceIdentityService.confirmar(
    req.params.id,
    req.user.id,
    certificadoOriginalVisto === true,
  );
  res.set('Cache-Control', 'no-store').status(200).json(result);
}
