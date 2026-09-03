import type { NextFunction, Request, Response } from 'express';
import { validationResult } from 'express-validator';

import { AppError } from '../utils/AppError';

// Corre después de las cadenas de validación de express-validator en cada
// ruta; si hay errores, corta con un 400 controlado en vez de dejar pasar
// datos inválidos al controller/service.
export function validate(req: Request, _res: Response, next: NextFunction): void {
  const result = validationResult(req);
  if (result.isEmpty()) {
    next();
    return;
  }

  const [firstError] = result.array({ onlyFirstError: true });
  const message =
    typeof firstError.msg === 'string' ? firstError.msg : 'Datos de entrada inválidos';
  next(new AppError(message, 400));
}
