import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../utils/AppError';
import { verifySolicitudToken } from '../utils/solicitudToken';

/**
 * Autentica las llamadas del postulante con el token temporal emitido por
 * POST /solicitudes/confirmar-codigo (NO es un JWT de Supabase Auth) y
 * exige que corresponda a la solicitud de la ruta (:id): un token de una
 * solicitud no sirve para otra.
 */
export function authenticateSolicitud(req: Request, _res: Response, next: NextFunction): void {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    next(new AppError('Missing or malformed Authorization header', 401));
    return;
  }

  const solicitudId = verifySolicitudToken(token);
  if (!solicitudId) {
    next(new AppError('Invalid or expired token', 401));
    return;
  }
  if (solicitudId !== req.params.id) {
    next(new AppError('El token no corresponde a esta solicitud', 403));
    return;
  }

  req.solicitudId = solicitudId;
  next();
}
