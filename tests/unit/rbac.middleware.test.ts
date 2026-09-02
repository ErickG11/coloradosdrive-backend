import type { Request, Response } from 'express';

import { requireRole } from '../../src/middlewares/rbac.middleware';
import type { AuthenticatedUser } from '../../src/models/user.model';
import { AppError } from '../../src/utils/AppError';

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
    const middleware = requireRole('admin', 'instructor');
    const req = buildRequest({ id: 'u1', email: 'a@a.com', role: 'instructor' });

    middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });
});
