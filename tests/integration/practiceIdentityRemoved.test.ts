import request from 'supertest';
jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: { from: jest.fn(), rpc: jest.fn(), channel: jest.fn(), removeChannel: jest.fn() },
  supabaseAnon: {},
}));
jest.mock('../../src/config/jwks', () => ({ verifySupabaseJwt: jest.fn() }));
import { createApp } from '../../src/app';
import { supabaseAdmin } from '../../src/config/supabase';
import { verifySupabaseJwt } from '../../src/config/jwks';
import { createChain } from '../helpers/supabaseMock';
import { sinInscripcionPendiente } from '../helpers/authMocks';
import { mockAuthToken } from '../helpers/tokens';

// ADR 026: la confirmación de la cédula original ya no la hace el instructor.
const from = supabaseAdmin.from as jest.Mock;
const rpc = supabaseAdmin.rpc as jest.Mock;
const verify = verifySupabaseJwt as jest.Mock;
const slotId = '11111111-1111-4111-8111-111111111111';
const app = createApp();

describe('El instructor no confirma la identidad presencial', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    rpc.mockReset();
    from.mockReset();
    from.mockImplementation((table: string) =>
      table === 'enrollments'
        ? sinInscripcionPendiente()
        : createChain({
            data: { rol: 'instructor', activo: true, debe_cambiar_password: false },
            error: null,
          }),
    );
  });

  it('la ruta del instructor ya no existe y no llega a la base', async () => {
    const res = await request(app)
      .patch(`/practice-slots/${slotId}/identidad-presencial`)
      .set('Authorization', `Bearer ${mockAuthToken(verify, 'instructor')}`)
      .send({ cedulaOriginalVista: true });
    expect(res.status).toBe(404);
    expect(rpc).not.toHaveBeenCalledWith('confirmar_identidad_presencial', expect.anything());
  });

  it('la agenda del instructor no consulta franjas con identidad pendiente', async () => {
    from.mockImplementation((table: string) =>
      table === 'practice_slots'
        ? createChain({ data: [], error: null })
        : table === 'enrollments'
          ? sinInscripcionPendiente()
          : createChain({
              data: { rol: 'instructor', activo: true, debe_cambiar_password: false },
              error: null,
            }),
    );
    const res = await request(app)
      .get('/practice-slots')
      .set('Authorization', `Bearer ${mockAuthToken(verify, 'instructor')}`);
    expect(res.status).toBe(200);
    expect(rpc).not.toHaveBeenCalledWith('franjas_identidad_pendiente', expect.anything());
  });
});
