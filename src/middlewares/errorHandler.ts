import type { NextFunction, Request, Response } from 'express';

import { isProduction } from '../config/env';
import { AppError } from '../utils/AppError';

interface ErrorResponseBody {
  status: 'error';
  message: string;
  stack?: string;
  code?: string;
  field?: string;
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
    res
      .status(invalidJson ? 400 : 500)
      .json({
        status: 'error',
        message: invalidJson ? 'Cuerpo JSON inválido' : 'Internal server error',
      });
    return;
  }
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const message =
    err instanceof AppError && err.isOperational ? err.message : 'Internal server error';

  if (!(err instanceof AppError) || !err.isOperational) {
    console.error(err);
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
