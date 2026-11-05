import type { Server } from 'node:http';

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import express from 'express';

import { AppError } from '../utils/AppError';

// Límite de cuerpo JSON de las rutas de inscripción: solo texto corto
// (correo, datos personales, motivos). Los archivos van por multipart.
export const ENROLLMENT_JSON_LIMIT = '16kb';
export const ENROLLMENT_JSON_PATHS = [
  '/webhooks/kushki',
  '/admin/pagos',
  '/estudiantes/inscripcion/pagos',
  '/solicitudes',
  '/public/inscripcion',
  '/admin/solicitudes',
  '/admin/inscripciones',
];

// Cabeceras (ms). keepAliveTimeout supera los ~60 s del proxy de Railway para
// que no cierre conexiones que el proxy aún reutiliza; headersTimeout mitiga
// slowloris; requestTimeout acota subidas lentas (el máximo de archivo es 2 MiB).
export const SERVER_TIMEOUTS = {
  keepAliveTimeout: 65_000,
  headersTimeout: 70_000,
  requestTimeout: 60_000,
} as const;

export function applyServerTimeouts(
  server: Pick<Server, 'keepAliveTimeout' | 'headersTimeout' | 'requestTimeout'> | undefined,
): void {
  if (!server) return;
  server.keepAliveTimeout = SERVER_TIMEOUTS.keepAliveTimeout;
  server.headersTimeout = SERVER_TIMEOUTS.headersTimeout;
  server.requestTimeout = SERVER_TIMEOUTS.requestTimeout;
}

// body-parser produce errores sueltos (sin AppError): se traducen aquí para que
// la respuesta sea estable y nunca eco del cuerpo recibido.
export function jsonBody(limit: string): RequestHandler {
  const parser = express.json({ limit });
  return (req: Request, res: Response, next: NextFunction): void => {
    parser(req, res, (error?: unknown) => {
      if (!error) {
        next();
        return;
      }
      const type = (error as { type?: unknown }).type;
      if (type === 'entity.too.large') {
        next(new AppError('El cuerpo de la solicitud es demasiado grande', 413, { code: 'CUERPO_DEMASIADO_GRANDE' }));
        return;
      }
      if (type === 'entity.parse.failed') {
        next(new AppError('Cuerpo JSON inválido', 400, { code: 'JSON_INVALIDO' }));
        return;
      }
      next(error);
    });
  };
}

// Las respuestas de esta API contienen datos personales o de sesión: nunca se cachean.
export function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.set('Cache-Control', 'no-store');
  next();
}
