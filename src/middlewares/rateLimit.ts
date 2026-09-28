import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';

import { env } from '../config/env';
import { AppError } from '../utils/AppError';

const WINDOW_MS = 15 * 60_000;

export function buildRateLimiter(max: number, skip = false): RequestHandler {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => skip,
    handler: (_req, _res, next) => {
      next(new AppError('Demasiadas solicitudes. Intenta de nuevo en unos minutos', 429));
    },
  });
}

// Los tests de integración ejercitan estas rutas muchas veces desde la misma
// IP; el comportamiento del límite se prueba aparte con buildRateLimiter.
const skipInTests = env.NODE_ENV === 'test';

// Endpoints públicos de una sola acción (enviar/confirmar código): 5
// requests por IP cada 15 minutos.
export const verificationRateLimiter = buildRateLimiter(5, skipInTests);

// Subida de documentos y captura de datos: un postulante real sube hasta 4
// documentos con reintentos (foto borrosa), así que el límite es más
// generoso (20 cada 15 minutos) que el de verificación.
export const applicationRateLimiter = buildRateLimiter(20, skipInTests);
