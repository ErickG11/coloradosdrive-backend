import type { Request } from 'express';
import { AppError } from './AppError';

/**
 * Id del usuario autenticado. Las rutas que lo usan ya pasan por `authenticate`;
 * si llegara a faltar se responde 401 en lugar de fallar con un error interno.
 */
export function authenticatedUserId(req: Request): string {
  const id = req.user?.id;
  if (!id) throw new AppError('Sesión no válida.', 401, { code: 'NO_AUTENTICADO' });
  return id;
}
