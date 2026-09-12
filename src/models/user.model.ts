export const ROLES = ['admin', 'estudiante', 'instructor'] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export interface AuthenticatedUser {
  id: string;
  email: string | undefined;
  role: Role;
}

// Perfil completo de la tabla `users`, reflejando migrations/001_init.sql.
export interface UserProfile {
  id: string;
  cedula: string;
  nombreCompleto: string;
  telefono: string | null;
  rol: Role;
  createdAt: string;
  updatedAt: string;
}

// Proyección mínima para poblar selectores de usuario por rol (ej. el
// instructor de una franja de práctica) - no expone cedula/telefono,
// que no hacen falta para ese caso de uso.
export interface UserSummary {
  id: string;
  nombreCompleto: string;
}
