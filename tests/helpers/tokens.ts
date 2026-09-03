import jwt from 'jsonwebtoken';

import type { Role } from '../../src/models/user.model';

// Firma JWTs reales contra el mismo SUPABASE_JWT_SECRET de prueba que usa
// tests/setupEnv.ts, para probar authenticate/requireRole de punta a punta
// sin mockear jsonwebtoken.
export function signToken(role: Role, overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    {
      sub: 'test-user-id',
      email: 'test-user@example.com',
      app_metadata: { role },
      ...overrides,
    },
    'test-jwt-secret',
  );
}
