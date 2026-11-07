import type { NextFunction, Request, Response } from 'express';

import { isProduction } from '../config/env';
import { normalizeSolicitudError, solicitudErrorCode } from '../utils/solicitudError';
import { AppError } from '../utils/AppError';
import { logSafeError } from '../utils/safeLog';
import { MENSAJE_DATOS_DUPLICADOS } from '../config/enrollmentCatalog';

const ADMIN_IDENTITY_CODES = new Set([
  'CEDULA_DUPLICADA',
  'IDENTIDAD_NO_VERIFICADA',
  'ESTUDIOS_NO_VERIFICADOS',
  'CUENTA_YA_EXISTE',
]);

interface ErrorResponseBody {
  status: 'error';
  message: string;
  stack?: string;
  code?: string;
  field?: string;
  detalles?: Record<string, unknown>;
  faltantes?: unknown;
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404));
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response<ErrorResponseBody>,
  _next: NextFunction,
): void {
  // Frontera de salida S1: tampoco revelar detalles/campos/stack por rutas hermanas.
  const identityError = normalizeSolicitudError(err);
  const authenticatedAdmin =
    req.user?.role === 'admin' && /^\/admin(?:\/|$|\?)/.test(req.originalUrl);
  if (!authenticatedAdmin && ADMIN_IDENTITY_CODES.has(solicitudErrorCode(identityError))) {
    res.status(409).json({
      status: 'error',
      message: MENSAJE_DATOS_DUPLICADOS,
      code: 'DATOS_NO_REGISTRADOS',
    });
    return;
  }
  if (
    req.method === 'POST' &&
    /^\/admin\/estudiantes\/[^/?]+\/identidad-presencial\/?(?:\?|$)/i.test(req.originalUrl) &&
    !(err instanceof AppError)
  ) {
    const invalidJson = 'type' in err && err.type === 'entity.parse.failed';
    logSafeError('student_identity_request_failed', err);
    res.status(invalidJson ? 400 : 503).json({
      status: 'error',
      message: invalidJson
        ? 'Cuerpo JSON inválido'
        : 'No se pudo confirmar la identidad. Recarga la ficha.',
      code: invalidJson ? 'INVALID_JSON' : 'IDENTIDAD_NO_CONFIRMADA',
    });
    return;
  }
  if (
    /^\/(?:(?:admin\/)?solicitudes|admin\/inscripciones|public\/inscripcion)(?:\/|$|\?)/.test(
      req.originalUrl,
    )
  ) {
    const normalized = normalizeSolicitudError(err);
    const operational = normalized instanceof AppError;
    if (!operational) logSafeError('enrollment_request_failed', err);
    const authRequired = operational && normalized.statusCode === 401;
    res.status(operational ? normalized.statusCode : 500).json({
      status: 'error',
      message: authRequired
        ? 'Verifica tu correo para continuar'
        : operational
          ? normalized.message
          : 'No se pudo completar la operación',
      code: solicitudErrorCode(normalized),
      ...(operational && normalized.field ? { field: normalized.field } : {}),
      ...(operational && normalized.detalles
        ? {
            detalles: normalized.detalles,
            ...(normalized.detalles.faltantes ? { faltantes: normalized.detalles.faltantes } : {}),
          }
        : {}),
    });
    return;
  }
  // body-parser adjunta el JSON original a SyntaxError; puede contener el comentario de RF-04.
  if (
    req.method === 'POST' &&
    /^\/estudiantes\/practice-ratings\/?(?:\?|$)/i.test(req.originalUrl) &&
    !(err instanceof AppError)
  ) {
    const invalidJson = 'type' in err && err.type === 'entity.parse.failed';
    console.error(
      JSON.stringify({
        event: 'practice_rating_request_failed',
        code: invalidJson ? 'INVALID_JSON' : 'INTERNAL_ERROR',
      }),
    );
    res.status(invalidJson ? 400 : 500).json({
      status: 'error',
      message: invalidJson ? 'Cuerpo JSON inválido' : 'Internal server error',
      ...(invalidJson ? { code: 'INVALID_FIELD' } : {}),
    });
    return;
  }
  // body-parser adjunta el cuerpo a SyntaxError. D nunca lo imprime ni devuelve.
  if (
    req.method === 'POST' &&
    /^\/admin\/estudiantes\/[^/?]+\/eliminar\/?(?:\?|$)/i.test(req.originalUrl) &&
    !(err instanceof AppError)
  ) {
    const invalidJson = 'type' in err && err.type === 'entity.parse.failed';
    console.error(
      JSON.stringify({
        event: 'student_deletion_request_failed',
        code: invalidJson ? 'INVALID_JSON' : 'INTERNAL_ERROR',
      }),
    );
    res.status(invalidJson ? 400 : 500).json({
      status: 'error',
      message: invalidJson ? 'Cuerpo JSON inválido' : 'Internal server error',
    });
    return;
  }
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const message =
    err instanceof AppError && err.isOperational ? err.message : 'Internal server error';

  if (!(err instanceof AppError) || !err.isOperational) {
    logSafeError('unhandled_request_error', err);
  }

  const body: ErrorResponseBody = { status: 'error', message };
  if (err instanceof AppError && err.code) {
    body.code = err.code;
    if (err.field) body.field = err.field;
  }
  if (!isProduction) {
    body.stack = err.stack;
  }

  res.status(statusCode).json(body);
}
