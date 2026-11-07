import type { Request, RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';

import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import { enrollmentRateKey } from '../utils/enrollmentRateKey';

const WINDOW_MS = 15 * 60_000;

export function buildRateLimiter(
  max: number,
  skip = false,
  keyGenerator?: (req: Request) => string,
): RequestHandler {
  return rateLimit({
    windowMs: WINDOW_MS,
    ...(keyGenerator ? { keyGenerator } : {}),
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => skip,
    handler: (_req, _res, next) => {
      next(
        new AppError('Demasiadas solicitudes. Intenta de nuevo en unos minutos', 429, {
          code: 'LIMITE_PETICIONES',
        }),
      );
    },
  });
}

// Los tests de integración ejercitan estas rutas muchas veces desde la misma
// IP; el comportamiento del límite se prueba aparte con buildRateLimiter.
const skipInTests = env.NODE_ENV === 'test';

// La emisión de códigos usa límites persistentes (enrollmentLimits.middleware).
// Los límites generales de confirmación/acciones conservan su protección adicional.
export function correoRateKey(req: Request): string {
  const body = req.body as { correo?: unknown } | undefined;
  const correo = typeof body?.correo === 'string' ? body.correo.trim().toLowerCase() : '';
  return enrollmentRateKey('correo', correo, env.ENROLLMENT_RATE_HMAC_SECRET);
}
export const verificationRateLimiter = buildRateLimiter(120, skipInTests);
export const applicationRateLimiter = buildRateLimiter(300, skipInTests);

// Listado público de cursos para la landing (GET /public/courses): es la
// primera ruta 100% pública sin ningún otro gate de por medio (ni auth ni
// token de solicitud), así que necesita su propio límite aunque sea de
// solo lectura. Más generoso que los de arriba porque un solo request
// trae todo el catálogo (no es un flujo de varios pasos).
export const publicReadRateLimiter = buildRateLimiter(60, skipInTests);
