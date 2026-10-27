import request from 'supertest';
jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: { from: jest.fn(), rpc: jest.fn(), channel: jest.fn(), removeChannel: jest.fn() }, supabaseAnon: {},
}));
jest.mock('../../src/config/jwks', () => ({ verifySupabaseJwt: jest.fn() }));
import { createApp } from '../../src/app';
import { supabaseAdmin } from '../../src/config/supabase';
import { verifySupabaseJwt } from '../../src/config/jwks';
import type { NotificationRow } from '../../src/models/notification.model';
import { createChain } from '../helpers/supabaseMock';
import { mockAuthToken } from '../helpers/tokens';

const rpc = supabaseAdmin.rpc as jest.Mock;
const from = supabaseAdmin.from as jest.Mock;
const verify = verifySupabaseJwt as jest.Mock;
const id = '11111111-1111-4111-8111-111111111111';
const row: NotificationRow = {
  id, user_id: 'test-user-id', tipo: 'recordatorio_practica', titulo: 'Tu práctica', mensaje: 'Confirmar es opcional',
  practice_slot_id: 'slot', scheduled_at: '2026-10-27T20:00:00Z', created_at: '2026-10-27T19:40:00Z', read_at: null,
  email_status: 'pendiente', email_attempts: 1, email_last_error: 'detalle interno',
  email_next_attempt_at: '', email_lease_token: 'secreto-interno', email_locked_until: '',
};
const app = createApp();
const auth = (role: 'estudiante' | 'instructor' | 'admin' = 'estudiante') => `Bearer ${mockAuthToken(verify, role)}`;

describe('API de notificaciones del propietario', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    rpc.mockReset();
    from.mockReturnValue(createChain({ data: { activo: true, rol: 'instructor', debe_cambiar_password: false }, error: null }));
  });
  it.each(['estudiante', 'instructor'] as const)('lista para %s solo con el actor del JWT y metadatos publicos', async (role) => {
    rpc.mockResolvedValue({ data: { items: [row], total: 3, unreadCount: 2 }, error: null });
    const res = await request(app).get('/notifications?page=2&pageSize=1&userId=otro').set('Authorization', auth(role));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 2, pageSize: 1, total: 3, unreadCount: 2,
      items: [{ id, practiceSlotId: 'slot', emailStatus: 'pendiente', emailAttempts: 1 }] });
    expect(res.body.items[0]).not.toHaveProperty('email_last_error');
    expect(res.body.items[0]).not.toHaveProperty('email_lease_token');
    expect(rpc).toHaveBeenCalledWith('list_user_notifications', { p_user: 'test-user-id', p_page: 2, p_page_size: 1 });
  });
  it.each(['page=0', 'page=1.5', 'page=1000001', 'pageSize=101', 'page=1&page=2'])('rechaza paginacion invalida %s', async (query) => {
    const res = await request(app).get(`/notifications?${query}`).set('Authorization', auth());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_FIELD');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('marcar un aviso ajeno o inexistente devuelve 404 y no acepta otro actor en el body', async () => {
    rpc.mockReturnValue(createChain({ data: null, error: null }));
    const res = await request(app).patch(`/notifications/${id}/read`).set('Authorization', auth()).send({ userId: 'otro' });
    expect(res.status).toBe(404);
    expect(rpc).toHaveBeenCalledWith('mark_user_notification_read', { p_user: 'test-user-id', p_id: id });
  });
  it('marca un aviso propio y devuelve readAt', async () => {
    rpc.mockReturnValue(createChain({ data: { ...row, read_at: row.created_at }, error: null }));
    const res = await request(app).patch(`/notifications/${id}/read`).set('Authorization', auth());
    expect(res.status).toBe(200);
    expect(res.body.readAt).toBe(row.created_at);
  });
  it('read-all utiliza exclusivamente al propietario', async () => {
    rpc.mockResolvedValue({ data: 2, error: null });
    const res = await request(app).post('/notifications/read-all').set('Authorization', auth()).send({ userId: 'otro' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updatedCount: 2 });
    expect(rpc).toHaveBeenCalledWith('read_all_user_notifications', { p_user: 'test-user-id' });
  });
  it('valida UUID y requiere sesion con rol de alumno o instructor', async () => {
    expect((await request(app).patch('/notifications/no-uuid/read').set('Authorization', auth())).status).toBe(400);
    expect((await request(app).get('/notifications')).status).toBe(401);
    expect((await request(app).get('/notifications').set('Authorization', auth('admin'))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});
