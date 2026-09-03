import type { Request, Response } from 'express';

import { authenticate } from '../../src/middlewares/auth.middleware';
import { AppError } from '../../src/utils/AppError';

// Jest hoists jest.mock() calls above these imports, so config/jwks is
// already mocked by the time auth.middleware is loaded. Se mockea
// config/jwks.ts (no jose directamente): ese módulo usa un import()
// dinámico real para cargar jose (necesario para funcionar en Node 18,
// ver config/jwks.ts), que se escapa del registro de módulos de Jest y
// no se puede interceptar con jest.mock('jose', ...).
jest.mock('../../src/config/jwks', () => ({
  verifySupabaseJwt: jest.fn(),
}));

import { verifySupabaseJwt } from '../../src/config/jwks';

const mockedVerify = verifySupabaseJwt as unknown as jest.Mock;

function buildRequest(authorization?: string): Request {
  return { headers: { authorization } } as unknown as Request;
}

function buildResponse(): Response {
  return {} as Response;
}

describe('authenticate middleware', () => {
  const res = buildResponse();
  let next: jest.Mock;

  beforeEach(() => {
    next = jest.fn();
    mockedVerify.mockReset();
  });

  it('rejects requests without an Authorization header', async () => {
    await authenticate(buildRequest(undefined), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]?.[0] as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(401);
  });

  it('rejects a malformed Authorization header (no Bearer scheme)', async () => {
    await authenticate(buildRequest('Token abc123'), res, next);

    const err = next.mock.calls[0]?.[0] as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(401);
  });

  it('rejects a token that fails verification against the JWKS', async () => {
    mockedVerify.mockRejectedValue(new Error('signature verification failed'));

    await authenticate(buildRequest('Bearer expired.token.here'), res, next);

    const err = next.mock.calls[0]?.[0] as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('Invalid or expired token');
  });

  it('rejects a valid token missing the subject claim', async () => {
    mockedVerify.mockResolvedValue({ app_metadata: { role: 'admin' } });

    await authenticate(buildRequest('Bearer valid.token.here'), res, next);

    const err = next.mock.calls[0]?.[0] as AppError;
    expect(err.statusCode).toBe(401);
  });

  it('rejects a valid token with a missing or unrecognized role claim', async () => {
    mockedVerify.mockResolvedValue({ sub: 'user-123', app_metadata: { role: 'superadmin' } });

    await authenticate(buildRequest('Bearer valid.token.here'), res, next);

    const err = next.mock.calls[0]?.[0] as AppError;
    expect(err.statusCode).toBe(403);
  });

  it('attaches req.user and calls next() with no error for a valid token', async () => {
    mockedVerify.mockResolvedValue({
      sub: 'user-123',
      email: 'estudiante@example.com',
      app_metadata: { role: 'estudiante' },
    });

    const req = buildRequest('Bearer valid.token.here');
    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toEqual({
      id: 'user-123',
      email: 'estudiante@example.com',
      role: 'estudiante',
    });
  });
});
