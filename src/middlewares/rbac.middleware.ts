import type { NextFunction, Request, Response } from 'express';

import type { Role } from '../models/user.model';
import { AppError } from '../utils/AppError';

/**
 * Restricts an endpoint to the given roles. Must run after `authenticate`,
 * which is responsible for populating req.user.
 */
export function requireRole(
  ...allowedRoles: Role[]
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AppError('Authentication required', 401));
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      next(new AppError('Insufficient permissions for this resource', 403));
      return;
    }

    next();
  };
}
