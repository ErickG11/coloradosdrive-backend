import type { AuthenticatedUser } from './user.model';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      // Id de la solicitud de inscripción autenticada con el token
      // temporal (ver solicitudAuth.middleware.ts).
      solicitudId?: string;
    }
  }
}

export {};
