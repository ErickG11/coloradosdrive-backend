import type { NextFunction, Request, Response } from 'express';

import { isProduction } from '../config/env';
import { AppError } from '../utils/AppError';

interface ErrorResponseBody {
  status: 'error';
  message: string;
  stack?: string;
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404));
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response<ErrorResponseBody>,
  _next: NextFunction,
): void {
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const message =
    err instanceof AppError && err.isOperational ? err.message : 'Internal server error';

  if (!(err instanceof AppError) || !err.isOperational) {
    console.error(err);
  }

  const body: ErrorResponseBody = { status: 'error', message };
  if (!isProduction) {
    body.stack = err.stack;
  }

  res.status(statusCode).json(body);
}
