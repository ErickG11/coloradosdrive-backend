import type { NextFunction, Request, Response } from 'express';
import type { JWTPayload } from 'jose';

import { verifySupabaseJwt } from '../config/jwks';
import { isRole, type AuthenticatedUser } from '../models/user.model';
import { AppError } from '../utils/AppError';

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
    req.user = toAuthenticatedUser(payload);
    next();
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
      return;
    }
    next(new AppError('Invalid or expired token', 401));
  }
}
