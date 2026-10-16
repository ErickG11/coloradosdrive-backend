import request from 'supertest';

jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn(),
    rpc: jest.fn(),
    auth: { admin: { getUserById: jest.fn(), updateUserById: jest.fn() } },
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

const from = supabaseAdmin.from as jest.Mock;
const rpc = supabaseAdmin.rpc as jest.Mock;
const verify = verifySupabaseJwt as jest.Mock;
const getAuth = supabaseAdmin.auth.admin.getUserById as jest.Mock;
const updateAuth = supabaseAdmin.auth.admin.updateUserById as jest.Mock;
const id = '22222222-2222-4222-8222-222222222222';
const path = '/admin/estudiantes';
const version = '2026-10-01T10:00:00.123456+00:00';
const user = {
  id,
  rol: 'estudiante',
  nombre_completo: 'Alumno',
  cedula: '1710034065',
  activo: true,
  telefono: null,
  fecha_nacimiento: null,
  tipo_sangre: null,
  genero: null,
  ciudadania: null,
  direccion: null,
  status: 'activo',
  debe_cambiar_password: false,
  created_at: version,
  updated_at: version,
};
const token = (role: 'admin' | 'instructor' | 'estudiante' = 'admin') =>
  `Bearer ${mockAuthToken(verify, role)}`;

describe('admin estudiantes A', () => {
  const app = createApp();
  beforeEach(() => {
    from.mockReset();
    rpc.mockReset();
    verify.mockReset();
    getAuth.mockReset();
    updateAuth.mockReset();
  });

  it.each(['list', 'detail'])('%s requires admin', async (kind) => {
    const call = () =>
      kind === 'list' ? request(app).get(path) : request(app).get(`${path}/${id}`);
    expect((await call()).status).toBe(401);
    expect((await call().set('Authorization', token('instructor'))).status).toBe(403);
    from.mockReturnValue(
      createChain({ data: { activo: true, debe_cambiar_password: false }, error: null }),
    );
    expect((await call().set('Authorization', token('estudiante'))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
    expect(getAuth).not.toHaveBeenCalled();
    expect(updateAuth).not.toHaveBeenCalled();
  });

  it('returns requirements and cohort totals in the same list request', async () => {
    const payload = {
      items: [
        { id, requirements: { pending: ['Documentos entregados'], unavailable: ['Pagos al día'] } },
      ],
      total: 1,
      page: 2,
      pageSize: 20,
      cohortSummary: {
        id,
        name: 'A',
        activeStudents: 24,
        matchingActiveStudents: 1,
        usedCapacity: 25,
        totalCapacity: 30,
      },
    };
    rpc.mockResolvedValue({ data: payload, error: null });
    const response = await request(app)
      .get(path)
      .query({ q: 'JOSÉ', cohortId: id, page: 2 })
      .set('Authorization', token());
    expect(response.status).toBe(200);
    expect(response.body).toEqual(payload);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'list_admin_students',
      expect.objectContaining({ p_q: 'JOSÉ', p_cohort: id, p_page: 2 }),
    );
    expect(getAuth).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it('parses list filters independently and does not touch Auth', async () => {
    rpc.mockResolvedValue({ data: { items: [], total: 0, page: 2, pageSize: 5 }, error: null });
    const res = await request(app)
      .get(path)
      .query({
        q: '+593 (99)',
        activo: false,
        pendienteCohorte: true,
        documentosPendientes: false,
        incluirHistorial: true,
        page: 2,
        pageSize: 5,
      })
      .set('Authorization', token());
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      'list_admin_students',
      expect.objectContaining({
        p_q: '+593 (99)',
        p_active: false,
        p_pending: true,
        p_documents_pending: false,
        p_history: true,
        p_page: 2,
        p_page_size: 5,
      }),
    );
    expect(getAuth).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it.each([
    { page: 0 },
    { pageSize: 101 },
    { activo: 'yes' },
    { courseId: 'bad' },
    { correo: 'a@example.com' },
    { q: ' ' },
    { q: 'x'.repeat(81) },
    { incluirHistorial: 'maybe' },
  ])('rejects invalid/unknown filters %s', async (query) => {
    const res = await request(app).get(path).query(query).set('Authorization', token());
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns the existing expanded profile without enrollments', async () => {
    from
      .mockReturnValueOnce(createChain({ data: user, error: null }))
      .mockReturnValueOnce(createChain({ data: [], error: null }))
      .mockReturnValue(createChain({ data: [], error: null }));
    getAuth.mockResolvedValue({ data: { user: { email: 'auth@example.com' } }, error: null });
    const res = await request(app).get(`${path}/${id}`).set('Authorization', token());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id,
      correo: 'auth@example.com',
      graduation: { pendingCount: null, enrollments: [] },
      practiceSchedule: { upcoming: [], recent: [], recovery: [] },
      enrollments: [],
      updatedAt: version,
    });
  });

  it('returns 404 for a missing student', async () => {
    from.mockReturnValue(createChain({ data: null, error: null }));
    expect((await request(app).get(`${path}/${id}`).set('Authorization', token())).status).toBe(
      404,
    );
    expect(getAuth).not.toHaveBeenCalled();
  });

  it('reports migration not installed without using a nontransactional fallback', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
    expect((await request(app).get(path).set('Authorization', token())).status).toBe(503);
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects invalid editing bodies and exposes no operation endpoints', async () => {
    expect(
      (
        await request(app)
          .patch(`${path}/${id}`)
          .set('Authorization', token())
          .send({ nombreCompleto: 'Otro' })
      ).status,
    ).toBe(400);
    expect(
      (await request(app).get(`${path}/operaciones/${id}`).set('Authorization', token())).status,
    ).toBe(404);
    expect(updateAuth).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('PATCH requires authentication and admin', async () => {
    const call = () =>
      request(app).patch(`${path}/${id}`).send({ updatedAt: version, nombreCompleto: 'Nuevo' });
    expect((await call()).status).toBe(401);
    expect((await call().set('Authorization', token('instructor'))).status).toBe(403);
    from.mockReturnValue(
      createChain({ data: { activo: true, debe_cambiar_password: false }, error: null }),
    );
    expect((await call().set('Authorization', token('estudiante'))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('PATCH preserves the version and rejects fields outside the profile', async () => {
    from.mockImplementation((table: string) =>
      createChain({ data: table === 'student_deletion_operations' ? null : user, error: null }),
    );
    rpc.mockResolvedValue({
      data: { operationId: id, updatedAt: version, changedFields: ['nombre_completo'] },
      error: null,
    });
    expect(
      (
        await request(app)
          .patch(`${path}/${id}`)
          .set('Authorization', token())
          .send({ updatedAt: version, nombreCompleto: 'Nuevo' })
      ).status,
    ).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      'save_student_profile',
      expect.objectContaining({ p_base_version: version }),
    );
    rpc.mockClear();
    expect(
      (
        await request(app)
          .patch(`${path}/${id}`)
          .set('Authorization', token())
          .send({ updatedAt: version, activo: false })
      ).status,
    ).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['fechaNacimiento', '2026-02-30'],
    ['fechaNacimiento', '2026-2-01'],
    ['fechaNacimiento', '0000-01-01'],
    ['fechaNacimiento', '2026-01-01T00:00:00Z'],
    ['updatedAt', '2026-02-30T10:00:00.123456+00:00'],
    ['updatedAt', 'not-a-date'],
    ['telefono', 'x'.repeat(21)],
    ['direccion', 'x'.repeat(501)],
    ['tipoSangre', 'x'.repeat(501)],
    ['genero', 'x'.repeat(501)],
    ['ciudadania', 'x'.repeat(501)],
    ['telefono', 123],
    ['direccion', {}],
  ])('PATCH rejects invalid %s with 400 before Auth or SQL', async (field, value) => {
    const response = await request(app)
      .patch(`${path}/${id}`)
      .set('Authorization', token())
      .send({ updatedAt: version, correo: 'new@example.com', [field]: value });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'INVALID_FIELD', field });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(getAuth).not.toHaveBeenCalled();
    expect(updateAuth).not.toHaveBeenCalled();
  });

  it('PATCH accepts a leap date and the exact field length limits', async () => {
    from.mockImplementation((table: string) =>
      createChain({ data: table === 'student_deletion_operations' ? null : user, error: null }),
    );
    rpc.mockResolvedValue({
      data: { operationId: id, updatedAt: version, changedFields: [] },
      error: null,
    });
    const response = await request(app)
      .patch(`${path}/${id}`)
      .set('Authorization', token())
      .send({
        updatedAt: version,
        fechaNacimiento: '2000-02-29',
        telefono: 'x'.repeat(20),
        direccion: 'x'.repeat(500),
        tipoSangre: 'x'.repeat(500),
        genero: 'x'.repeat(500),
        ciudadania: 'x'.repeat(500),
      });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
