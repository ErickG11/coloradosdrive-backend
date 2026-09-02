import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';

import { authenticate } from '../../src/middlewares/auth.middleware';
import { AppError } from '../../src/utils/AppError';

// Jest hoists jest.mock() calls above these imports, so config/env and
// jsonwebtoken are already mocked by the time auth.middleware is loaded.
jest.mock('../../src/config/env', () => ({
  env: { SUPABASE_JWT_SECRET: 'test-jwt-secret' },
}));

jest.mock('jsonwebtoken');

// jsonwebtoken's `verify` is overloaded; casting to jest.Mock keeps the
// mock helpers (mockReturnValue, mockImplementation) untyped-but-usable
// instead of collapsing to a single, unhelpful overload signature.
const mockedVerify = jwt.verify as unknown as jest.Mock;

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
  });

  it('rejects requests without an Authorization header', () => {
    authenticate(buildRequest(undefined), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]?.[0] as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(401);
  });

  it('rejects a malformed Authorization header (no Bearer scheme)', () => {
    authenticate(buildRequest('Token abc123'), res, next);

    const err = next.mock.calls[0]?.[0] as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(401);
  });

  it('rejects a token that fails signature/expiry verification', () => {
    mockedVerify.mockImplementation(() => {
      throw new Error('jwt expired');
    });

    authenticate(buildRequest('Bearer expired.token.here'), res, next);

    const err = next.mock.calls[0]?.[0] as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('Invalid or expired token');
  });

  it('rejects a valid token missing the subject claim', () => {
    mockedVerify.mockReturnValue({ app_metadata: { role: 'admin' } });

    authenticate(buildRequest('Bearer valid.token.here'), res, next);

    const err = next.mock.calls[0]?.[0] as AppError;
    expect(err.statusCode).toBe(401);
  });

  it('rejects a valid token with a missing or unrecognized role claim', () => {
    mockedVerify.mockReturnValue({ sub: 'user-123', app_metadata: { role: 'superadmin' } });

    authenticate(buildRequest('Bearer valid.token.here'), res, next);

    const err = next.mock.calls[0]?.[0] as AppError;
    expect(err.statusCode).toBe(403);
  });

  it('attaches req.user and calls next() with no error for a valid token', () => {
    mockedVerify.mockReturnValue({
      sub: 'user-123',
      email: 'estudiante@example.com',
      app_metadata: { role: 'estudiante' },
    });

    const req = buildRequest('Bearer valid.token.here');
    authenticate(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toEqual({
      id: 'user-123',
      email: 'estudiante@example.com',
      role: 'estudiante',
    });
  });
});
