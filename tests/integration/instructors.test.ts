import request from 'supertest';

jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn(), rpc: jest.fn(),
    auth: { admin: { createUser: jest.fn(), deleteUser: jest.fn(),
      updateUserById: jest.fn(), getUserById: jest.fn() } },
  },
  supabaseAnon: {},
}));
jest.mock('../../src/config/jwks', () => ({ verifySupabaseJwt: jest.fn() }));
jest.mock('../../src/config/mailer', () => ({ mailer: { sendMail: jest.fn() } }));

import { createApp } from '../../src/app';
import { verifySupabaseJwt } from '../../src/config/jwks';
import { mailer } from '../../src/config/mailer';
import { supabaseAdmin } from '../../src/config/supabase';
import { createChain } from '../helpers/supabaseMock';
import { mockAuthToken } from '../helpers/tokens';

const from = supabaseAdmin.from as jest.Mock;
const rpc = supabaseAdmin.rpc as jest.Mock;
const verify = verifySupabaseJwt as jest.Mock;
const createUser = supabaseAdmin.auth.admin.createUser as jest.Mock;
const deleteUser = supabaseAdmin.auth.admin.deleteUser as jest.Mock;
const updateUser = supabaseAdmin.auth.admin.updateUserById as jest.Mock;
const getUser = supabaseAdmin.auth.admin.getUserById as jest.Mock;
const sendMail = mailer.sendMail as jest.Mock;
const id = '22222222-2222-4222-8222-222222222222';
const input = {
  cedula: '1710034065', nombreCompleto: 'Ana Torres',
  telefono: '0991234567', correo: 'ana@example.com',
};
const row = {
  id, cedula: input.cedula, nombre_completo: input.nombreCompleto,
  telefono: input.telefono, rol: 'instructor', activo: true,
  debe_cambiar_password: true, created_at: '2026-01-01T00:00:00Z',
};

describe('módulo de instructores', () => {
  const app = createApp();
  const token = (role: 'admin' | 'estudiante' | 'instructor') =>
    `Bearer ${mockAuthToken(verify, role)}`;
  beforeEach(() => {
    for (const mock of [from, rpc, verify, createUser, deleteUser, updateUser, getUser, sendMail])
      mock.mockReset();
    sendMail.mockResolvedValue({});
  });

  const adminPaths = [
    ['get', '/admin/instructores'],
    ['post', '/admin/instructores'],
    ['get', `/admin/instructores/${id}`],
    ['patch', `/admin/instructores/${id}`],
    ['post', `/admin/instructores/${id}/desactivar`],
    ['post', `/admin/instructores/${id}/reactivar`],
    ['post', `/admin/instructores/${id}/reenviar-credenciales`],
  ] as const;
  function call(method: 'get' | 'post' | 'patch', path: string) {
    if (method === 'get') return request(app).get(path);
    if (method === 'patch') return request(app).patch(path);
    return request(app).post(path);
  }

  it.each(adminPaths)('%s %s exige token y rol admin', async (method, path) => {
    expect((await call(method, path)).status).toBe(401);
    from.mockReturnValueOnce(createChain({ data: { debe_cambiar_password: false }, error: null }));
    expect((await call(method, path).set('Authorization', token('estudiante'))).status).toBe(403);
    expect((await call(method, path).set('Authorization', token('instructor'))).status).toBe(403);
  });

  it('valida cédula y campos antes de llamar a Auth', async () => {
    const res = await request(app).post('/admin/instructores')
      .set('Authorization', token('admin'))
      .send({ ...input, cedula: '1710034064', rol: 'admin' });
    expect(res.status).toBe(400);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('crea Auth y perfil, envía correo y nunca devuelve la clave', async () => {
    from.mockReturnValueOnce(createChain({ data: null, error: null }));
    from.mockReturnValueOnce(createChain({ data: row, error: null }));
    createUser.mockResolvedValue({ data: { user: { id } }, error: null });
    const res = await request(app).post('/admin/instructores')
      .set('Authorization', token('admin')).send(input);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id, cedula: input.cedula, activo: true });
    expect(res.body).not.toHaveProperty('temporaryPassword');
    expect(res.body).not.toHaveProperty('debeCambiarPassword');
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({
      email: input.correo, app_metadata: { role: 'instructor' },
    }));
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('compensa en Auth si falla el correo después de crear el perfil', async () => {
    from.mockReturnValueOnce(createChain({ data: null, error: null }));
    from.mockReturnValueOnce(createChain({ data: row, error: null }));
    createUser.mockResolvedValue({ data: { user: { id } }, error: null });
    sendMail.mockRejectedValue(new Error('smtp indisponible'));
    deleteUser.mockResolvedValue({ error: null });
    const res = await request(app).post('/admin/instructores')
      .set('Authorization', token('admin')).send(input);
    expect(res.status).toBe(502);
    expect(deleteUser).toHaveBeenCalledWith(id);
    expect(JSON.stringify(res.body)).not.toContain('smtp indisponible');
  });

  it('compensa en Auth si falla la inserción del perfil', async () => {
    from.mockReturnValueOnce(createChain({ data: null, error: null }));
    from.mockReturnValueOnce(createChain({ data: null, error: { code: '23505' } }));
    createUser.mockResolvedValue({ data: { user: { id } }, error: null });
    deleteUser.mockResolvedValue({ error: null });
    const res = await request(app).post('/admin/instructores')
      .set('Authorization', token('admin')).send(input);
    expect(res.status).toBe(409);
    expect(deleteUser).toHaveBeenCalledWith(id);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('rechaza doble envío con cédula ya registrada sin crear otra identidad', async () => {
    from.mockReturnValueOnce(createChain({ data: { id }, error: null }));
    const res = await request(app).post('/admin/instructores')
      .set('Authorization', token('admin')).send(input);
    expect(res.status).toBe(409);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('lista con búsqueda, actividad y paginación', async () => {
    const chain = createChain({ data: [row], error: null, count: 1 });
    from.mockReturnValueOnce(chain);
    const res = await request(app).get('/admin/instructores')
      .query({ q: 'Ana', activo: 'true', page: '2', pageSize: '5' })
      .set('Authorization', token('admin'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 1, page: 2, pageSize: 5 });
    expect(chain.eq).toHaveBeenCalledWith('activo', true);
    expect(chain.range).toHaveBeenCalledWith(5, 9);
  });

  it('edita solo nombre y teléfono; rechaza correo y cédula', async () => {
    const forbidden = await request(app).patch(`/admin/instructores/${id}`)
      .set('Authorization', token('admin')).send({ correo: 'otro@example.com' });
    expect(forbidden.status).toBe(400);
    expect(from).not.toHaveBeenCalled();

    const write = createChain({ data: null, error: null });
    from.mockReturnValueOnce(createChain({ data: row, error: null }));
    from.mockReturnValueOnce(write);
    from.mockReturnValueOnce(createChain({ data: { ...row, nombre_completo: 'Ana Rojas' }, error: null }));
    getUser.mockResolvedValue({ data: { user: { email: input.correo } }, error: null });
    const edited = await request(app).patch(`/admin/instructores/${id}`)
      .set('Authorization', token('admin'))
      .send({ nombreCompleto: 'Ana Rojas', telefono: input.telefono });
    expect(edited.status).toBe(200);
    expect(write.update).toHaveBeenCalledWith({
      nombre_completo: 'Ana Rojas', telefono: input.telefono,
    });
  });

  it('instructor con clave temporal puede consultar estado y cambiarla', async () => {
    from.mockReturnValue(createChain({
      data: { rol: 'instructor', activo: true, debe_cambiar_password: true }, error: null,
    }));
    updateUser.mockResolvedValue({ error: null });
    const status = await request(app).get('/instructores/account-status')
      .set('Authorization', token('instructor'));
    expect(status.status).toBe(200);
    expect(status.body).toEqual({ mustChangePassword: true });
    const blocked = await request(app).get('/instructores/me')
      .set('Authorization', token('instructor'));
    expect(blocked.status).toBe(403);
    const changed = await request(app).post('/instructores/cambiar-password')
      .set('Authorization', token('instructor')).send({ nuevaPassword: 'nueva-clave-segura' });
    expect(changed.status).toBe(204);
    expect(updateUser).toHaveBeenCalledTimes(1);
  });

  it('desactivación con franjas futuras devuelve 409', async () => {
    from.mockReturnValueOnce(createChain({ data: row, error: null }));
    rpc.mockResolvedValue({ data: null, error: { code: 'CD024' } });
    const res = await request(app).post(`/admin/instructores/${id}/desactivar`)
      .set('Authorization', token('admin')).send({});
    expect(res.status).toBe(409);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('desactiva en BD antes del ban de Auth y reactiva retirando el ban', async () => {
    from.mockReturnValue(createChain({ data: row, error: null }));
    rpc.mockResolvedValue({ data: true, error: null });
    updateUser.mockResolvedValue({ error: null });
    getUser.mockResolvedValue({ data: { user: { email: input.correo } }, error: null });

    const off = await request(app).post(`/admin/instructores/${id}/desactivar`)
      .set('Authorization', token('admin')).send({});
    expect(off.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('set_instructor_active', { p_id: id, p_active: false });
    expect(updateUser).toHaveBeenCalledWith(id, { ban_duration: '876000h' });
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(updateUser.mock.invocationCallOrder[0]);

    const on = await request(app).post(`/admin/instructores/${id}/reactivar`)
      .set('Authorization', token('admin')).send({});
    expect(on.status).toBe(200);
    expect(updateUser).toHaveBeenLastCalledWith(id, { ban_duration: 'none' });
    expect(updateUser.mock.invocationCallOrder[1]).toBeLessThan(rpc.mock.invocationCallOrder[1]);
  });

  it('solo reenvía credenciales si la clave temporal sigue pendiente', async () => {
    from.mockReturnValueOnce(createChain({ data: { ...row, debe_cambiar_password: false }, error: null }));
    const denied = await request(app).post(`/admin/instructores/${id}/reenviar-credenciales`)
      .set('Authorization', token('admin')).send({});
    expect(denied.status).toBe(409);
    expect(updateUser).not.toHaveBeenCalled();

    from.mockReturnValueOnce(createChain({ data: row, error: null }));
    getUser.mockResolvedValue({ data: { user: { email: input.correo } }, error: null });
    updateUser.mockResolvedValue({ error: null });
    const sent = await request(app).post(`/admin/instructores/${id}/reenviar-credenciales`)
      .set('Authorization', token('admin')).send({});
    expect(sent.status).toBe(204);
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('consulta propia solo devuelve nombre del estudiante y datos de la franja', async () => {
    from.mockReturnValueOnce(createChain({
      data: { rol: 'instructor', activo: true, debe_cambiar_password: false }, error: null,
    }));
    from.mockReturnValueOnce(createChain({ data: row, error: null }));
    getUser.mockResolvedValue({ data: { user: { email: input.correo } }, error: null });
    from.mockReturnValueOnce(createChain({ data: [{
      id: 'slot-1', instructor_id: 'test-user-id', student_id: 'student-secret',
      cohort_id: 'cohort-1', scheduled_at: '2026-01-01T00:00:00Z',
      duration_minutes: 60, status: 'asignado', student: { nombre_completo: 'Estudiante' },
      instructor: { nombre_completo: input.nombreCompleto },
    }], error: null }));
    const res = await request(app).get('/instructores/me')
      .set('Authorization', token('instructor'));
    expect(res.status).toBe(200);
    expect(res.body.practiceSlots[0]).toMatchObject({ studentName: 'Estudiante' });
    expect(res.body.practiceSlots[0]).not.toHaveProperty('studentId');
    expect(res.body.practiceSlots[0]).not.toHaveProperty('instructorId');
  });
});
