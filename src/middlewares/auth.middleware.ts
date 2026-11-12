import type { NextFunction, Request, Response } from 'express';
import type { JWTPayload } from 'jose';

import { verifySupabaseJwt } from '../config/jwks';
import { supabaseAdmin } from '../config/supabase';
import { isRole, type AuthenticatedUser } from '../models/user.model';
import { AppError } from '../utils/AppError';
import {
  inscripcionIncompleta,
  permiteInscripcionIncompleta,
  MENSAJE_INSCRIPCION_INCOMPLETA,
} from '../services/studentEnrollmentAccess';
import { markGuard } from '../utils/routeGuards';

// Las excepciones de contraseña NO eximen de comprobar perfil y activo.
// Se compara baseUrl+path para cubrir los routers montados.
const CHANGE_PASSWORD_PATH = '/estudiantes/cambiar-password';

// Solo aplica a rol='estudiante' (ver toAuthenticatedUser): admin/instructor
// nunca disparan esta consulta. debe_cambiar_password no viaja en el JWT
// (vive en public.users, no en los claims de Supabase Auth), así que hace
// falta una consulta por request de estudiante.
async function assertPasswordNotPendingChange(req: Request, studentId: string): Promise<void> {
  const isChangePasswordRequest =
    (req.method === 'POST' && `${req.baseUrl}${req.path}` === CHANGE_PASSWORD_PATH) ||
    (req.method === 'GET' && `${req.baseUrl}${req.path}` === '/estudiantes/account-status');
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('activo,debe_cambiar_password,identity_access_blocked_at')
    .eq('id', studentId)
    .eq('rol', 'estudiante')
    .maybeSingle();

  if (error) {
    throw new AppError('No se pudo verificar el estado de la cuenta', 503);
  }
  if (!data?.activo) {
    throw new AppError('La cuenta del alumno está desactivada o no existe', 403, {
      code: 'ACCOUNT_INACTIVE',
    });
  }
  if (data.identity_access_blocked_at)
    throw new AppError('Tu acceso requiere revisión de la escuela.', 403, {
      code: 'SOLICITUD_ACCESO_REVOCADO',
    });
  if (!isChangePasswordRequest && data.debe_cambiar_password) {
    throw new AppError('Debes cambiar tu contraseña temporal antes de continuar', 403);
  }
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return null;
  }
  return token;
}

function extractRoleClaim(payload: JWTPayload): unknown {
  const appMetadata = payload.app_metadata;
  if (appMetadata && typeof appMetadata === 'object' && 'role' in appMetadata) {
    return (appMetadata as Record<string, unknown>).role;
  }
  return undefined;
}

function toAuthenticatedUser(payload: JWTPayload): AuthenticatedUser {
  if (typeof payload.sub !== 'string') {
    throw new AppError('Invalid token payload: missing subject claim', 401);
  }

  const emailClaim = payload.email;
  const role = extractRoleClaim(payload);

  if (!isRole(role)) {
    throw new AppError('Invalid token: missing or unrecognized role claim', 403);
  }

  return {
    id: payload.sub,
    email: typeof emailClaim === 'string' ? emailClaim : undefined,
    role,
  };
}

/**
 * Verifies the Supabase Auth JWT sent in the Authorization: Bearer header
 * against the project's JWKS (public key, via config/jwks.ts) and
 * attaches the resulting AuthenticatedUser to req.user.
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      throw new AppError('Missing or malformed Authorization header', 401);
    }

    const payload = await verifySupabaseJwt(token);
    const user = toAuthenticatedUser(payload);

    if (user.role === 'estudiante') {
      await assertPasswordNotPendingChange(req, user.id);
      if (
        !permiteInscripcionIncompleta(req.method, `${req.baseUrl}${req.path}`) &&
        (await inscripcionIncompleta(supabaseAdmin, user.id))
      )
        throw new AppError(MENSAJE_INSCRIPCION_INCOMPLETA, 403, { code: 'INSCRIPCION_INCOMPLETA' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
      return;
    }
    next(new AppError('Invalid or expired token', 401));
  }
}

markGuard(authenticate, 'authenticate');
