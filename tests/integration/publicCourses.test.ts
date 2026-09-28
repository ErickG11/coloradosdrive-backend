import request from 'supertest';

jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: { from: jest.fn() },
  supabaseAnon: {},
}));

jest.mock('../../src/config/jwks', () => ({
  verifySupabaseJwt: jest.fn(),
}));

import { createApp } from '../../src/app';
import { supabaseAdmin } from '../../src/config/supabase';
import { createChain } from '../helpers/supabaseMock';

const mockedFrom = supabaseAdmin.from as jest.Mock;

describe('GET /public/courses', () => {
  const app = createApp();

  beforeEach(() => {
    mockedFrom.mockReset();
  });

  it('responde sin necesidad de token', async () => {
    mockedFrom.mockReturnValueOnce(createChain({ data: [], error: null }));

    const res = await request(app).get('/public/courses');

    expect(res.status).toBe(200);
  });

  it('lista los cursos con la forma mínima: id, tipo, nombre, horasRequeridas', async () => {
    const courseRows = [
      { id: 'course-a', tipo: 'A', nombre: 'Motocicletas', horas_requeridas: 20 },
      {
        id: 'course-b',
        tipo: 'B',
        nombre: 'Vehículos livianos (transmisión manual y automática)',
        horas_requeridas: 30,
      },
    ];
    const chain = createChain({ data: courseRows, error: null });
    mockedFrom.mockReturnValueOnce(chain);

    const res = await request(app).get('/public/courses');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 'course-a', tipo: 'A', nombre: 'Motocicletas', horasRequeridas: 20 },
      {
        id: 'course-b',
        tipo: 'B',
        nombre: 'Vehículos livianos (transmisión manual y automática)',
        horasRequeridas: 30,
      },
    ]);
    expect(chain.select).toHaveBeenCalledWith('id, tipo, nombre, horas_requeridas');
  });

  it('no expone cohortes, precios ni cupos: cada curso solo tiene las 4 claves esperadas', async () => {
    const courseRows = [{ id: 'course-a', tipo: 'A', nombre: 'Motocicletas', horas_requeridas: 20 }];
    mockedFrom.mockReturnValueOnce(createChain({ data: courseRows, error: null }));

    const res = await request(app).get('/public/courses');

    expect(res.status).toBe(200);
    const [course] = res.body as Record<string, unknown>[];
    expect(Object.keys(course).sort()).toEqual(['horasRequeridas', 'id', 'nombre', 'tipo']);
  });

  it('propaga un error de la base como 500', async () => {
    mockedFrom.mockReturnValueOnce(createChain({ data: null, error: { message: 'boom' } }));

    const res = await request(app).get('/public/courses');

    expect(res.status).toBe(500);
  });
});
