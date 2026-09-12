import request from 'supertest';

jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: { from: jest.fn() },
  supabaseAnon: {},
}));

jest.mock('../../src/config/jwks', () => ({
  verifySupabaseJwt: jest.fn(),
}));

import { verifySupabaseJwt } from '../../src/config/jwks';

import { createApp } from '../../src/app';
import { supabaseAdmin } from '../../src/config/supabase';
import { createChain } from '../helpers/supabaseMock';
import { mockAuthToken } from '../helpers/tokens';

const mockedFrom = supabaseAdmin.from as jest.Mock;
const mockedVerifySupabaseJwt = verifySupabaseJwt as unknown as jest.Mock;

describe('GET /users', () => {
  const app = createApp();

  beforeEach(() => {
    mockedFrom.mockReset();
    mockedVerifySupabaseJwt.mockReset();
  });

  // Admin-only sin excepciones (ver docs/adr/008): la ampliación de
  // rol=instructor a cualquier autenticado (PR #11) se revirtió - los
  // listados de practice_slots ya embeben instructorName/studentName, así
  // que nadie fuera de admin necesita este endpoint para nada.
  describe('protección por autenticación y rol (RNF-03)', () => {
    it('sin token responde 401', async () => {
      const res = await request(app).get('/users').query({ rol: 'instructor' });
      expect(res.status).toBe(401);
    });

    it.each(['estudiante', 'instructor'] as const)(
      'con rol no-admin (%s) responde 403, sin importar qué rol se consulte',
      async (callerRole) => {
        const res = await request(app)
          .get('/users')
          .query({ rol: 'instructor' })
          .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, callerRole)}`);
        expect(res.status).toBe(403);
        expect(mockedFrom).not.toHaveBeenCalled();
      },
    );
  });

  it('sin query rol responde 400', async () => {
    const res = await request(app)
      .get('/users')
      .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`);
    expect(res.status).toBe(400);
    expect(mockedFrom).not.toHaveBeenCalled();
  });

  it('con rol inválido responde 400', async () => {
    const res = await request(app)
      .get('/users')
      .query({ rol: 'no-existe' })
      .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`);
    expect(res.status).toBe(400);
    expect(mockedFrom).not.toHaveBeenCalled();
  });

  it('lista los usuarios con el rol pedido', async () => {
    const userRows = [
      { id: 'instructor-a', nombre_completo: 'Ana Torres' },
      { id: 'instructor-b', nombre_completo: 'Bruno Salas' },
    ];
    mockedFrom.mockReturnValueOnce(createChain({ data: userRows, error: null }));

    const res = await request(app)
      .get('/users')
      .query({ rol: 'instructor' })
      .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`);

    expect(res.status).toBe(200);
    expect(mockedFrom).toHaveBeenCalledWith('users');
    expect(res.body).toEqual([
      { id: 'instructor-a', nombreCompleto: 'Ana Torres' },
      { id: 'instructor-b', nombreCompleto: 'Bruno Salas' },
    ]);
  });
});
