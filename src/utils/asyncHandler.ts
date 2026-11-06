import type { NextFunction, Request, Response } from 'express';

import { guardKindOf, markGuard } from './routeGuards';

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

// Envuelve un controller async para que Express reciba un handler que
// retorna void (Express no espera promesas), reenviando cualquier error
// al middleware centralizado en vez de necesitar try/catch en cada
// controller.
export function asyncHandler(
  handler: AsyncRequestHandler,
): (req: Request, res: Response, next: NextFunction) => void {
  const wrapped = (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
  // El envoltorio conserva la marca de guard para el inventario de rutas.
  const kind = guardKindOf(handler);
  return kind ? markGuard(wrapped, kind) : wrapped;
}
