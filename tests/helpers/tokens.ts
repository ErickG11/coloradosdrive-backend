import type { Role } from '../../src/models/user.model';

// Los tests de integración mockean config/jwks.ts (verifySupabaseJwt) en
// vez de generar un par de claves ES256 real (sería recrear
// infraestructura criptográfica que jose ya prueba por su cuenta) — ver
// ADR 003. Esto configura la siguiente llamada a verifySupabaseJwt para
// que resuelva el payload de un rol dado, y devuelve un token de
// relleno: su valor no importa, la verificación de firma está mockeada.
export function mockAuthToken(mockedVerifySupabaseJwt: jest.Mock, role: Role): string {
  mockedVerifySupabaseJwt.mockResolvedValueOnce({
    sub: 'test-user-id',
    email: 'test-user@example.com',
    app_metadata: { role },
  });
  return 'test-token';
}
