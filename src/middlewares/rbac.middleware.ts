import type { NextFunction, Request, Response } from 'express';

import type { Role } from '../models/user.model';
import { supabaseAdmin } from '../config/supabase';
import { AppError } from '../utils/AppError';

const INSTRUCTOR_PASSWORD_ROUTES = new Set([
  'GET /instructores/account-status',
  'POST /instructores/cambiar-password',
]);

// El estado de instructor se consulta por petición: un JWT anterior a la
// desactivación no conserva acceso útil. La excepción permite salir del
// estado de contraseña temporal sin abrir otras rutas.
export async function assertInstructorAccess(req: Request, instructorId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('rol,activo,debe_cambiar_password')
    .eq('id', instructorId)
    .maybeSingle();
  if (error) throw new AppError('No se pudo verificar el estado de la cuenta', 500);
  if (data?.rol !== 'instructor' || !data.activo)
    throw new AppError('La cuenta de instructor está inactiva', 403);
  if (data.debe_cambiar_password &&
      !INSTRUCTOR_PASSWORD_ROUTES.has(`${req.method} ${req.baseUrl}${req.path}`))
    throw new AppError('Debes cambiar tu contraseña temporal antes de continuar', 403);
}

/**
 * Restricts an endpoint to the given roles. Must run after `authenticate`,
 * which is responsible for populating req.user.
 */
export function requireRole(
  ...allowedRoles: Role[]
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AppError('Authentication required', 401));
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      next(new AppError('Insufficient permissions for this resource', 403));
      return;
    }

    if (req.user.role === 'instructor') {
      void assertInstructorAccess(req, req.user.id).then(() => { next(); }).catch(next);
      return;
    }
    next();
  };
}
