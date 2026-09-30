import type { Request, Response } from 'express';

jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: { from: jest.fn() },
}));

import { requireRole } from '../../src/middlewares/rbac.middleware';
import { supabaseAdmin } from '../../src/config/supabase';
import type { AuthenticatedUser } from '../../src/models/user.model';
import { AppError } from '../../src/utils/AppError';
import { createChain } from '../helpers/supabaseMock';

const mockedFrom = supabaseAdmin.from as jest.Mock;

function buildRequest(user?: AuthenticatedUser): Request {
  return { user } as unknown as Request;
}

function buildResponse(): Response {
  return {} as Response;
}

describe('requireRole middleware', () => {
  const res = buildResponse();
  let next: jest.Mock;

  beforeEach(() => {
    next = jest.fn();
    mockedFrom.mockReset();
  });

  it('rejects when req.user is not set (authenticate did not run)', () => {
    const middleware = requireRole('admin');

    middleware(buildRequest(undefined), res, next);

    const err = next.mock.calls[0]?.[0] as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(401);
  });

  it('rejects a user whose role is not in the allowed list', () => {
    const middleware = requireRole('admin', 'instructor');
    const req = buildRequest({ id: 'u1', email: 'a@a.com', role: 'estudiante' });

    middleware(req, res, next);

    const err = next.mock.calls[0]?.[0] as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(403);
  });

  it('calls next() with no error when the role is allowed', () => {
    const middleware = requireRole('admin');
    const req = buildRequest({ id: 'u1', email: 'a@a.com', role: 'admin' });

    middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('blocks an inactive instructor even with a valid role', async () => {
    mockedFrom.mockReturnValue(createChain({
      data: { rol: 'instructor', activo: false, debe_cambiar_password: false }, error: null,
    }));
    requireRole('instructor')(
      buildRequest({ id: 'u1', email: 'a@a.com', role: 'instructor' }), res, next);
    await new Promise(setImmediate);
    expect((next.mock.calls[0]?.[0] as AppError).statusCode).toBe(403);
  });
});
