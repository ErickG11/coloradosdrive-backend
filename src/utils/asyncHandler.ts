import type { NextFunction, Request, Response } from 'express';

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

// Envuelve un controller async para que Express reciba un handler que
// retorna void (Express no espera promesas), reenviando cualquier error
// al middleware centralizado en vez de necesitar try/catch en cada
// controller.
export function asyncHandler(
  handler: AsyncRequestHandler,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}
