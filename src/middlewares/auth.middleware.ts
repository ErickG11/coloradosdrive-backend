import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

import { env } from '../config/env';
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

function extractRoleClaim(payload: jwt.JwtPayload): unknown {
  const appMetadata: unknown = payload.app_metadata;
  if (appMetadata && typeof appMetadata === 'object' && 'role' in appMetadata) {
    return (appMetadata as Record<string, unknown>).role;
  }
  return undefined;
}

function toAuthenticatedUser(decoded: string | jwt.JwtPayload): AuthenticatedUser {
  if (typeof decoded === 'string') {
    throw new AppError('Invalid token payload', 401);
  }

  if (typeof decoded.sub !== 'string') {
    throw new AppError('Invalid token payload: missing subject claim', 401);
  }

  const emailClaim: unknown = decoded.email;
  const role = extractRoleClaim(decoded);

  if (!isRole(role)) {
    throw new AppError('Invalid token: missing or unrecognized role claim', 403);
  }

  return {
    id: decoded.sub,
    email: typeof emailClaim === 'string' ? emailClaim : undefined,
    role,
  };
}

/**
 * Verifies the Supabase Auth JWT sent in the Authorization: Bearer header
 * and attaches the resulting AuthenticatedUser to req.user. Does not
 * touch the network — Supabase JWTs are self-verified against
 * SUPABASE_JWT_SECRET, which is why this middleware can be unit tested
 * with mocked tokens and no live Supabase instance.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  try {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      throw new AppError('Missing or malformed Authorization header', 401);
    }

    const decoded = jwt.verify(token, env.SUPABASE_JWT_SECRET);
    req.user = toAuthenticatedUser(decoded);
    next();
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
      return;
    }
    next(new AppError('Invalid or expired token', 401));
  }
}
