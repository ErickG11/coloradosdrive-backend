import request from 'supertest';

jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: { from: jest.fn(), rpc: jest.fn(), channel: jest.fn(), removeChannel: jest.fn() },
  supabaseAnon: {},
}));
jest.mock('../../src/config/jwks', () => ({ verifySupabaseJwt: jest.fn() }));

import { createApp } from '../../src/app';
import { verifySupabaseJwt } from '../../src/config/jwks';
import { supabaseAdmin } from '../../src/config/supabase';
import { createChain } from '../helpers/supabaseMock';
import { mockAuthToken } from '../helpers/tokens';

const rpc = supabaseAdmin.rpc as jest.Mock;
const from = supabaseAdmin.from as jest.Mock;
const channel = supabaseAdmin.channel as jest.Mock;
const verify = verifySupabaseJwt as unknown as jest.Mock;
const target = '11111111-1111-4111-8111-111111111111';
const source = '22222222-2222-4222-8222-222222222222';
const app = createApp();

describe('E2: rutas de cupos para el alumno', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    rpc.mockReset();
    from.mockReturnValue(createChain({ data: { activo: true, debe_cambiar_password: false }, error: null }));
  });
  const auth = () => `Bearer ${mockAuthToken(verify, 'estudiante')}`;

  it.each(['released-for-me', 'my-pending'] as const)('GET %s usa el alumno del JWT, sin notificaciones', async (path) => {
    rpc.mockResolvedValue({ data: [], error: null });
    const res = await request(app).get(`/practice-slots/${path}?studentId=otro`).set('Authorization', auth());
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(rpc).toHaveBeenCalledWith(path === 'released-for-me'
      ? 'released_practice_slots_for_student' : 'pending_practice_slots_for_student', { p_student_id: 'test-user-id' });
    expect(channel).not.toHaveBeenCalled();
  });

  it.each(['admin', 'instructor'] as const)('rechaza todas las rutas E2 con rol %s', async (role) => {
    for (const path of ['released-for-me', 'my-pending']) {
      expect((await request(app).get(`/practice-slots/${path}`)
        .set('Authorization', `Bearer ${mockAuthToken(verify, role)}`)).status).toBe(403);
    }
    expect((await request(app).post(`/practice-slots/${target}/swap`)
      .set('Authorization', `Bearer ${mockAuthToken(verify, role)}`).send({})).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([null, 'no-es-uuid', 123, [source]])('rechaza practicaASoltarId inválido: %j', async (value) => {
    const res = await request(app).post(`/practice-slots/${target}/swap`).set('Authorization', auth())
      .send({ practicaASoltarId: value });
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('valida UUID del cupo antes de llamar SQL', async () => {
    const res = await request(app).post('/practice-slots/no-uuid/swap').set('Authorization', auth()).send({});
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['22023', 400, 'Debes elegir la práctica pendiente que vas a soltar'],
    ['22023', 400, 'Tienes una hora pendiente por reponer: no debes soltar otra práctica'],
    ['CD409', 409, 'Ya usaste tus 2 reprogramaciones'],
    ['CD409', 409, 'Otro alumno tomó este cupo o ya no está disponible'],
    ['55P03', 409, 'Otra operación está modificando la práctica; vuelve a consultar e inténtalo de nuevo'],
  ])('propaga conflicto o validación %s sin difundir', async (code, status, message) => {
    rpc.mockResolvedValue({ data: null, error: { code, message } });
    const res = await request(app).post(`/practice-slots/${target}/swap`).set('Authorization', auth()).send({});
    expect(res.status).toBe(status);
    expect(res.body.message).toBe(message);
    expect(channel).not.toHaveBeenCalled();
  });

  it.each([undefined, source])('swap utiliza el actor del JWT y devuelve el estado final (origen %s)', async (sourceId) => {
    rpc.mockResolvedValue({ data: {
      slot: { id: target, cohort_id: 'cohort', instructor_id: 'instructor', student_id: 'test-user-id',
        scheduled_at: '2099-01-01T15:00:00Z', duration_minutes: 60, status: 'asignado', attended: null,
        confirmed_at: null, confirmation_notified_at: null, release_notified_at: null, created_at: '', updated_at: '' },
      caso: sourceId ? 'B' : 'A', practicaSoltadaId: sourceId ?? null,
      cancellationId: 'cancellation', enrollmentId: 'enrollment', reprogramacionesRestantes: 1,
    }, error: null });
    const httpSend = jest.fn().mockResolvedValue({ success: true });
    channel.mockReturnValue({ httpSend });
    (supabaseAdmin.removeChannel as jest.Mock).mockResolvedValue(undefined);
    const res = await request(app).post(`/practice-slots/${target}/swap`).set('Authorization', auth())
      .send({ practicaASoltarId: sourceId, studentId: 'otro', reprogramacionesUsadas: 0 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ caso: sourceId ? 'B' : 'A', slot: { studentId: 'test-user-id', status: 'asignado' }, reprogramacionesRestantes: 1 });
    expect(rpc).toHaveBeenCalledWith('swap_practice_slot', {
      p_slot_id: target, p_student_id: 'test-user-id', p_source_slot_id: sourceId ?? null,
    });
    expect(httpSend.mock.calls).toEqual([['slots-updated', {}], ['slot-taken', {}]]);
  });

});
