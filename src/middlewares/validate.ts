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

// Validación estructurada opcional: además del mensaje devuelve `code`
// (INVALID_FIELD) y `field` (el campo que falló) para que el cliente pueda
// marcarlo. Solo la usan las rutas que lo piden (alumnos y cohortes); el
// resto de contratos sigue con `validate` y no cambia.
export function validateFields(req: Request, _res: Response, next: NextFunction): void {
  const result = validationResult(req);
  if (result.isEmpty()) {
    next();
    return;
  }
  const [error] = result.array({ onlyFirstError: true });
  const field = error.type === 'field' && error.path ? error.path : undefined;
  next(
    new AppError(typeof error.msg === 'string' ? error.msg : 'Datos de entrada inválidos', 400, {
      code: 'INVALID_FIELD',
      ...(field ? { field } : {}),
    }),
  );
}

// Nombre histórico usado por las rutas de alumnos.
export const validateStudentProfile = validateFields;
