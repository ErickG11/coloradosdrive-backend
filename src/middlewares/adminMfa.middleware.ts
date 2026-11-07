import type { NextFunction, Request, Response } from 'express';

import { verifySupabaseJwt } from '../config/jwks';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';

function bearer(header: string | undefined): string | null {
  const [scheme, token] = (header ?? '').split(' ');
  return scheme === 'Bearer' && token ? token : null;
}

// Con ADMIN_MFA_REQUIRED=true, toda ruta /admin/* exige un JWT de administrador con aal2
// (segundo factor TOTP verificado en esta sesión). Se monta antes de los routers /admin/* y
// no autentica por sí mismo: un token ausente o inválido sigue su camino y lo rechaza el
// authenticate de cada ruta (401); un rol distinto de admin lo rechaza requireRole (403).
export function adminMfaGuard(required: boolean = env.ADMIN_MFA_REQUIRED) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!required) {
      next();
      return;
    }
    const token = bearer(req.headers.authorization);
    if (!token) {
      next();
      return;
    }
    verifySupabaseJwt(token)
      .then((payload) => {
        const appMetadata = payload.app_metadata as { role?: unknown } | undefined;
        if (appMetadata?.role === 'admin' && payload.aal !== 'aal2') {
          next(
            new AppError('Verifica tu segundo factor para usar el panel de administración', 403, {
              code: 'MFA_REQUERIDA',
            }),
          );
          return;
        }
        next();
      })
      .catch(() => {
        next();
      });
  };
}
