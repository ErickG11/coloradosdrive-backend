import type { NextFunction, Request, Response } from 'express';

import { supabaseAdmin } from '../config/supabase';
import {
  MOTIVO_REQUISITOS_PENDIENTES,
  tieneRequisitosPendientes,
} from '../services/studentEnrollmentStatus.service';
import { AppError } from '../utils/AppError';

// Debe ir después de authenticate y requireRole('estudiante'). Falla cerrado: un error de
// consulta responde 503 en lugar de dejar pasar.
export function requireRequisitosVerificados(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    next(new AppError('Authentication required', 401));
    return;
  }
  tieneRequisitosPendientes(supabaseAdmin, req.user.id)
    .then((pendientes) => {
      if (pendientes) {
        next(new AppError(MOTIVO_REQUISITOS_PENDIENTES, 403, { code: 'REQUISITOS_PENDIENTES' }));
        return;
      }
      next();
    })
    .catch(() => {
      next(new AppError('No se pudo verificar tus requisitos', 503));
    });
}
