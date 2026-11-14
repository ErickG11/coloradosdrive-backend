import type { NextFunction, Request, Response } from 'express';

jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: { rpc: jest.fn() },
  supabaseAnon: {},
}));

import { supabaseAdmin } from '../../src/config/supabase';

const { requireEnrollmentPermission } = jest.requireActual<
  typeof import('../../src/middlewares/enrollmentPermission.middleware')
>('../../src/middlewares/enrollmentPermission.middleware');
const rpc = supabaseAdmin.rpc as unknown as jest.Mock;

function run(user?: { id: string }): Promise<unknown> {
  return new Promise((resolve) => {
    const next: NextFunction = (error?: unknown) => {
      resolve(error);
    };
    requireEnrollmentPermission('verify_identity')(
      { user } as unknown as Request,
      {} as Response,
      next,
    );
  });
}

describe('requireEnrollmentPermission', () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it('deja pasar cuando la función SQL concede el permiso', async () => {
    rpc.mockResolvedValue({ error: null });
    expect(await run({ id: 'admin-1' })).toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('assert_enrollment_permission_v2', {
      p_actor: 'admin-1',
      p_permission: 'verify_identity',
    });
  });

  it('rechaza si no hay usuario autenticado sin consultar la base', async () => {
    const error = await run(undefined);
    expect(error).toMatchObject({ code: 'PERMISO_REQUERIDO' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rechaza con PERMISO_REQUERIDO cuando la función SQL niega el permiso', async () => {
    rpc.mockResolvedValue({ error: { message: 'sin permiso', code: 'P0001' } });
    expect(await run({ id: 'admin-1' })).toMatchObject({ code: 'PERMISO_REQUERIDO' });
  });
});
