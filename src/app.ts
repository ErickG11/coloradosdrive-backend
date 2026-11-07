import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';

import { allowedCorsOrigins } from './config/cors';
import { env } from './config/env';
import {
  ENROLLMENT_JSON_LIMIT,
  ENROLLMENT_JSON_PATHS,
  jsonBody,
  noStore,
} from './config/serverHardening';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';
import { apiRouter } from './routes';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  // Railway termina TLS en un proxy: sin esto req.ip sería siempre el del
  // proxy y el rate limit por IP (routes/solicitud.routes.ts) limitaría a
  // todos los usuarios juntos.
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  // API JSON pura: nada debe renderizarse ni incrustarse en un marco.
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(
    cors({
      // CORS compara el origen exacto (esquema + host + puerto): FRONTEND_URL y, si existe, la
      // lista CORS_ORIGINS (vistas previas). Una FRONTEND_URL con barra final o ruta no amplía nada.
      origin: allowedCorsOrigins(env.FRONTEND_URL, env.CORS_ORIGINS),
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
      maxAge: 600,
    }),
  );
  // Las respuestas llevan datos personales o de sesión: nunca se cachean.
  app.use(noStore);
  // Cuerpo pequeño en inscripción; el resto conserva el límite por defecto (100 kb).
  app.use(ENROLLMENT_JSON_PATHS, jsonBody(ENROLLMENT_JSON_LIMIT));
  app.use(express.json());

  app.use(apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
