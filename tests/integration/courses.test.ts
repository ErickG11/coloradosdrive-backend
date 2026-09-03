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

describe('GET /courses', () => {
  const app = createApp();

  beforeEach(() => {
    mockedFrom.mockReset();
    mockedVerifySupabaseJwt.mockReset();
  });

  describe('protección por autenticación y rol (RNF-03)', () => {
    it('sin token responde 401', async () => {
      const res = await request(app).get('/courses');
      expect(res.status).toBe(401);
    });

    it('con rol no-admin responde 403', async () => {
      const res = await request(app)
        .get('/courses')
        .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'instructor')}`);
      expect(res.status).toBe(403);
      expect(mockedFrom).not.toHaveBeenCalled();
    });
  });

  it('lista los cursos', async () => {
    const courseRows = [
      {
        id: 'course-a',
        nombre: 'Motocicletas',
        tipo: 'A',
        descripcion: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'course-b',
        nombre: 'Vehículos livianos (transmisión manual y automática)',
        tipo: 'B',
        descripcion: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ];
    mockedFrom.mockReturnValueOnce(createChain({ data: courseRows, error: null }));

    const res = await request(app)
      .get('/courses')
      .set('Authorization', `Bearer ${mockAuthToken(mockedVerifySupabaseJwt, 'admin')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({ id: 'course-a', tipo: 'A', nombre: 'Motocicletas' }),
      expect.objectContaining({ id: 'course-b', tipo: 'B' }),
    ]);
  });
});
