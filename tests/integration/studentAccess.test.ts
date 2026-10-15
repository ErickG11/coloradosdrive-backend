import request from 'supertest';
jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn(),
    rpc: jest.fn(),
    auth: { admin: { updateUserById: jest.fn() } },
  },
  supabaseAnon: {},
}));
jest.mock('../../src/config/jwks', () => ({ verifySupabaseJwt: jest.fn() }));
jest.mock('../../src/config/mailer', () => ({ mailer: { sendMail: jest.fn() } }));
import { createApp } from '../../src/app';
import { supabaseAdmin } from '../../src/config/supabase';
import { verifySupabaseJwt } from '../../src/config/jwks';
import { createChain } from '../helpers/supabaseMock';
import { mockAuthToken } from '../helpers/tokens';
const from = supabaseAdmin.from as jest.Mock,
  rpc = supabaseAdmin.rpc as jest.Mock;
const auth = supabaseAdmin.auth.admin.updateUserById as jest.Mock;
const verify = verifySupabaseJwt as jest.Mock;
const id = '22222222-2222-4222-8222-222222222222';
describe('B admin access and student exceptions', () => {
  const app = createApp();
  beforeEach(() => {
    jest.clearAllMocks();
    from.mockReset();
    rpc.mockReset();
    auth.mockReset();
    verify.mockReset();
  });
  it.each(['desactivar', 'reactivar'])('%s is admin-only', async (action) => {
    expect((await request(app).post(`/admin/estudiantes/${id}/${action}`)).status).toBe(401);
    expect(
      (
        await request(app)
          .post(`/admin/estudiantes/${id}/${action}`)
          .set('Authorization', `Bearer ${mockAuthToken(verify, 'instructor')}`)
      ).status,
    ).toBe(403);
    expect(auth).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('admin deactivates without touching enrollments or past attendance through REST', async () => {
    from.mockReturnValue(createChain({ data: { id }, error: null }));
    rpc.mockResolvedValue({ data: true, error: null });
    auth.mockResolvedValue({ data: {}, error: null });
    const response = await request(app)
      .post(`/admin/estudiantes/${id}/desactivar`)
      .set('Authorization', `Bearer ${mockAuthToken(verify, 'admin')}`);
    expect(response.status).toBe(200);
    expect(response.body.activo).toBe(false);
    expect(from).toHaveBeenCalledWith('users');
    expect(rpc).toHaveBeenCalledWith(
      'set_student_active',
      expect.objectContaining({ p_student: id, p_active: false }),
    );
  });
  it.each(['/estudiantes/account-status', '/estudiantes/cambiar-password'])(
    'inactive/missing profiles cannot use exception %s',
    async (path) => {
      for (const data of [null, { activo: false, debe_cambiar_password: false }]) {
        from.mockReturnValue(createChain({ data, error: null }));
        const call = path.endsWith('cambiar-password')
          ? request(app).post(path).send({ nuevaPassword: 'fixture-password' })
          : request(app).get(path);
        const res = await call.set(
          'Authorization',
          `Bearer ${mockAuthToken(verify, 'estudiante')}`,
        );
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ACCOUNT_INACTIVE');
      }
      expect(auth).not.toHaveBeenCalled();
    },
  );
});
